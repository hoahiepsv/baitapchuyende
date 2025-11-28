import React, { useState, useEffect, useRef } from 'react';
import { ModelType, Topic, Question, FileData, Difficulty, SubQuestion } from './types';
import { initializeGemini, analyzeTopics, generateQuestions, fixImageCode } from './services/geminiService';
import { runPythonCode, initPyodide } from './services/pythonService';
import { exportToDocx } from './services/docxService';
import { Save, Edit3, FileText, Settings, Download, Play, RefreshCw, Upload, X, Loader2, Eye, EyeOff } from 'lucide-react';
import FileSaver from 'file-saver';

declare global {
  interface Window {
    katex: any;
    renderMathInElement: any;
  }
}

// Simple unique ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

const LatexPreview: React.FC<{ content: string }> = ({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. Set text content first (clears previous render)
    if (containerRef.current) {
        containerRef.current.textContent = content;
    }

    // 2. Render Math
    if (containerRef.current && window.renderMathInElement) {
        try {
            window.renderMathInElement(containerRef.current, {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "$", right: "$", display: false},
                    {left: "\\(", right: "\\)", display: false},
                    {left: "\\[", right: "\\]", display: true}
                ],
                throwOnError: false,
                strict: false, // Ignore minor LaTeX warnings
                trust: true,   // Allow more commands
                errorCallback: (msg: string, err: any) => {
                    // Suppress the specific quirks mode error if it persists
                    if (msg && msg.includes("quirks mode")) return;
                    console.warn("KaTeX Warning:", msg);
                }
            });
        } catch (e: any) {
            // Check if it's the specific Quirks Mode error that KaTeX throws
            if (e.message && e.message.includes("quirks mode")) {
                console.warn("KaTeX blocked by Quirks Mode. Math will display as raw text.");
            } else {
                console.error("KaTeX Render Error:", e);
            }
        }
    }
  }, [content]);

  return <div ref={containerRef} className="latex-preview-content text-gray-900 leading-relaxed whitespace-pre-wrap tracking-wide" />;
};

function App() {
  // State
  const [apiKey, setApiKey] = useState<string>('');
  const [isKeySaved, setIsKeySaved] = useState<boolean>(false);
  const [model, setModel] = useState<ModelType>(ModelType.FLASH);
  const [manualTopic, setManualTopic] = useState<string>('');
  
  // Two categories of files
  const [distFiles, setDistFiles] = useState<FileData[]>([]); // Phân phối chương trình
  const [bankFiles, setBankFiles] = useState<FileData[]>([]); // Ngân hàng câu hỏi
  
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [pyodideReady, setPyodideReady] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);

  // Load API Key & Init Pyodide
  useEffect(() => {
    const savedKey = localStorage.getItem('GEMINI_API_KEY');
    if (savedKey) {
      setApiKey(savedKey);
      setIsKeySaved(true);
      initializeGemini(savedKey);
    }
    initPyodide().then(() => setPyodideReady(true)).catch(e => console.error(e));
  }, []);

  const handleSaveKey = () => {
    if (apiKey.trim()) {
      localStorage.setItem('GEMINI_API_KEY', apiKey);
      setIsKeySaved(true);
      initializeGemini(apiKey);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, category: 'distribution' | 'bank') => {
    if (e.target.files && e.target.files.length > 0) {
      const rawFiles: File[] = Array.from(e.target.files);
      const newFiles: FileData[] = [];

      for (const file of rawFiles) {
        let content = `[File: ${file.name}]`;
        if (file.type === "text/plain") {
             content = await file.text();
        } 
        
        newFiles.push({
            id: generateId(),
            name: file.name,
            content: content,
            category: category
        });
      }
      
      if (category === 'distribution') {
          setDistFiles(prev => [...prev, ...newFiles]);
      } else {
          setBankFiles(prev => [...prev, ...newFiles]);
      }
      
      e.target.value = '';
    }
  };

  const removeFile = (id: string, category: 'distribution' | 'bank') => {
      if (category === 'distribution') {
          setDistFiles(prev => prev.filter(f => f.id !== id));
      } else {
          setBankFiles(prev => prev.filter(f => f.id !== id));
      }
  };

  const handleAnalyze = async () => {
    if (!apiKey) return alert("Vui lòng nhập API Key");
    setIsAnalyzing(true);
    try {
        const distText = distFiles.map(f => f.content).join("\n");
        const bankText = bankFiles.map(f => f.content).join("\n");
        const result = await analyzeTopics(distText, bankText, manualTopic, model);
        setTopics(result);
    } catch (error) {
        alert("Lỗi phân tích: " + error);
    } finally {
        setIsAnalyzing(false);
    }
  };

  const handleGenerate = async () => {
    if (!apiKey) return alert("Vui lòng nhập API Key");
    setIsGenerating(true);
    setQuestions([]);
    setShowAnswers(false);
    
    try {
        const allContext = [...distFiles, ...bankFiles].map(f => f.content).join("\n");
        const rawQuestions = await generateQuestions(topics, manualTopic, allContext, model);
        
        // Execute Python code for images (Recursive for parts)
        const processedQuestions = await Promise.all(rawQuestions.map(async (q) => {
            // Main image
            let mainImage = undefined;
            if (q.hasImage && q.pythonCode) {
                mainImage = await runPythonCode(q.pythonCode) || undefined;
            }

            // Parts images
            let processedParts = undefined;
            if (q.parts && q.parts.length > 0) {
                 processedParts = await Promise.all(q.parts.map(async (p: SubQuestion) => {
                     if (p.hasImage && p.pythonCode) {
                         const pImg = await runPythonCode(p.pythonCode);
                         return { ...p, imageData: pImg || undefined };
                     }
                     return p;
                 }));
            }

            return { ...q, imageData: mainImage, parts: processedParts };
        }));
        
        setQuestions(processedQuestions);
    } catch (error) {
        alert("Lỗi tạo bài tập: " + error);
    } finally {
        setIsGenerating(false);
    }
  };

  const handleRedraw = async (itemId: string, parentQuestionId?: string) => {
    // Determine context (Main question or Part)
    let q: Question | undefined;
    let part: SubQuestion | undefined;
    let currentCode: string | undefined;
    let contentContext: string = "";

    if (parentQuestionId) {
        q = questions.find(q => q.id === parentQuestionId);
        part = q?.parts?.find(p => p.id === itemId);
        currentCode = part?.pythonCode;
        contentContext = part?.content || "";
    } else {
        q = questions.find(q => q.id === itemId);
        currentCode = q?.pythonCode;
        contentContext = q?.content || "";
    }

    if (!currentCode) return;

    const instruction = prompt("Bạn muốn sửa gì? (Ví dụ: 'Xoay hình', 'Kéo dài đoạn AB'...)");
    if (!instruction) return;

    // Optimistic UI update to clear image
    setQuestions(prev => prev.map(item => {
        if (parentQuestionId) {
             if (item.id === parentQuestionId && item.parts) {
                 return {
                     ...item,
                     parts: item.parts.map(p => p.id === itemId ? { ...p, imageData: undefined } : p)
                 };
             }
        } else {
             if (item.id === itemId) {
                 return { ...item, imageData: undefined };
             }
        }
        return item;
    }));

    try {
        const newCode = await fixImageCode(currentCode, instruction, contentContext, model);
        const newImage = await runPythonCode(newCode);
        
        setQuestions(prev => prev.map(item => {
             if (parentQuestionId) {
                  if (item.id === parentQuestionId && item.parts) {
                      return {
                          ...item,
                          parts: item.parts.map(p => p.id === itemId ? {
                              ...p, pythonCode: newCode, imageData: newImage || undefined
                          } : p)
                      };
                  }
             } else {
                  if (item.id === itemId) {
                      return {
                          ...item, pythonCode: newCode, imageData: newImage || undefined
                      };
                  }
             }
             return item;
        }));
    } catch (e) {
        alert("Lỗi vẽ lại: " + e);
    }
  };

  const handleExport = async () => {
    const blob = await exportToDocx(questions, "BÀI TẬP CHUYÊN ĐỀ");
    const saveAs = (FileSaver as any).saveAs || FileSaver;
    saveAs(blob, "Bai_Tap_Chuyen_De.docx");
  };

  const updateDifficultyCount = (topicId: string, diff: Difficulty, val: number) => {
      setTopics(prev => prev.map(t => {
          if (t.id !== topicId) return t;
          return {
              ...t,
              difficultyCounts: {
                  ...t.difficultyCounts,
                  [diff]: Math.max(0, val)
              }
          };
      }));
  };

  // Helper component for file list
  const FileList = ({ files, category }: { files: FileData[], category: 'distribution' | 'bank' }) => (
      <div className="space-y-2 mt-2">
          {files.map(file => (
              <div key={file.id} className="flex items-center justify-between bg-blue-50 px-3 py-2 rounded text-sm text-blue-800 border border-blue-100">
                  <div className="flex items-center gap-2 truncate">
                      <FileText size={14} />
                      <span className="truncate max-w-[200px]">{file.name}</span>
                  </div>
                  <button onClick={() => removeFile(file.id, category)} className="text-red-400 hover:text-red-600 transition">
                      <X size={16} />
                  </button>
              </div>
          ))}
      </div>
  );

  const ImageWithRedraw = ({ id, imageData, parentId }: { id: string, imageData: string, parentId?: string }) => (
       <div className="mt-4 flex flex-col items-center">
           <div className="relative group inline-block">
                <div className="p-2 bg-white border rounded shadow-sm">
                    <img src={imageData} alt="Hình vẽ minh hoạ" className="max-w-full md:max-w-md h-auto" />
                </div>
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                        onClick={() => handleRedraw(id, parentId)}
                        className="bg-white text-blue-600 p-2 rounded shadow border hover:bg-blue-50 flex items-center gap-1 text-xs font-bold"
                        title="Vẽ lại hình này"
                    >
                        <RefreshCw size={14} /> Vẽ lại
                    </button>
                </div>
           </div>
       </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-blue-700 text-white p-4 shadow-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl md:text-2xl font-bold uppercase tracking-wider">RA BÀI TẬP THEO CHUYÊN ĐỀ</h1>
            <p className="text-blue-200 text-xs md:text-sm">Bản quyền: Lê Hoà Hiệp (0983.676.470)</p>
          </div>
          
          <div className="flex items-center space-x-2 md:space-x-4">
             {/* Model Selector */}
             <div className="flex bg-blue-800 rounded-lg p-1">
                <button 
                  onClick={() => setModel(ModelType.FLASH)}
                  className={`px-2 md:px-3 py-1 rounded text-xs md:text-sm font-medium transition ${model === ModelType.FLASH ? 'bg-white text-blue-800' : 'text-blue-300 hover:text-white'}`}
                >
                  Flash (Nhanh)
                </button>
                <button 
                  onClick={() => setModel(ModelType.PRO)}
                  className={`px-2 md:px-3 py-1 rounded text-xs md:text-sm font-medium transition ${model === ModelType.PRO ? 'bg-white text-blue-800' : 'text-blue-300 hover:text-white'}`}
                >
                  Pro (Thông minh)
                </button>
             </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-6">
        
        {/* API Key Section */}
        {!isKeySaved ? (
           <div className="bg-white p-6 rounded-xl shadow-sm border border-blue-200">
             <label className="block text-sm font-bold text-gray-700 mb-2">Google Gemini API Key</label>
             <div className="flex gap-2 flex-col md:flex-row">
               <input 
                 type="password" 
                 value={apiKey}
                 onChange={(e) => setApiKey(e.target.value)}
                 className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                 placeholder="Dán API Key vào đây..."
               />
               <button 
                 onClick={handleSaveKey}
                 className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg flex items-center justify-center gap-2 font-medium"
               >
                 <Save size={18} /> Lưu Key
               </button>
             </div>
           </div>
        ) : (
          <div className="flex justify-end">
            <button onClick={() => setIsKeySaved(false)} className="text-blue-600 text-sm hover:underline flex items-center gap-1">
               <Edit3 size={14} /> Thay đổi API Key
            </button>
          </div>
        )}

        {/* Input Zones */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
           
           {/* Left Column: Data Input */}
           <div className="space-y-6">
               
               {/* 1. Program Distribution */}
               <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                  <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                      <span className="bg-blue-100 text-blue-700 w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold">1</span>
                      Phân Phối Chương Trình
                  </h3>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:bg-blue-50 transition relative">
                        <input 
                            type="file" multiple 
                            onChange={(e) => handleFileUpload(e, 'distribution')} 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="text-gray-500 text-sm">
                            <Upload className="mx-auto mb-1 text-blue-400" size={20} />
                            Tải lên tập tin (PDF/Ảnh/Word...)
                        </div>
                  </div>
                  <FileList files={distFiles} category="distribution" />
               </div>

               {/* 2. Question Bank */}
               <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                  <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                      <span className="bg-blue-100 text-blue-700 w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold">2</span>
                      Đề Cương / Ngân Hàng Câu Hỏi
                  </h3>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:bg-blue-50 transition relative">
                        <input 
                            type="file" multiple 
                            onChange={(e) => handleFileUpload(e, 'bank')} 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="text-gray-500 text-sm">
                            <Upload className="mx-auto mb-1 text-blue-400" size={20} />
                            Tải lên tập tin tham khảo
                        </div>
                  </div>
                  <FileList files={bankFiles} category="bank" />
               </div>

               {/* Manual Input */}
               <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Nhập Thủ Công Chuyên Đề (AI tự suy luận)</label>
                    <input 
                        type="text"
                        value={manualTopic}
                        onChange={(e) => setManualTopic(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                        placeholder="Ví dụ: Hình chóp S.ABCD đáy hình vuông..."
                    />
               </div>

               {/* Analyze Action */}
               <button 
                    onClick={handleAnalyze}
                    disabled={isAnalyzing}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white py-3 rounded-lg font-bold flex justify-center items-center gap-2 shadow-md transition-all"
               >
                    {isAnalyzing ? <Loader2 className="animate-spin" /> : <Settings />}
                    PHÂN TÍCH & LÊN KẾ HOẠCH
               </button>
           </div>

           {/* Right Column: Topics & Config */}
           <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col h-full min-h-[500px]">
              <h2 className="text-xl font-bold text-gray-800 border-b pb-3 flex items-center gap-2">
                <FileText className="text-blue-600" /> Danh Sách Chuyên Đề
              </h2>
              
              <div className="flex-1 overflow-y-auto mt-4 space-y-3">
                {topics.length === 0 && !isAnalyzing && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400">
                      <p className="italic">Chưa có dữ liệu.</p>
                      <p className="text-sm">Vui lòng tải lên tài liệu và nhấn Phân Tích.</p>
                  </div>
                )}
                
                {isAnalyzing && (
                    <div className="flex flex-col items-center justify-center h-40 space-y-2">
                        <Loader2 className="animate-spin text-blue-500" size={32} />
                        <span className="text-gray-600 font-medium">AI đang đọc tài liệu...</span>
                    </div>
                )}

                {topics.map(topic => (
                  <div key={topic.id} className="p-3 rounded-lg border hover:bg-blue-50 transition bg-white flex flex-col gap-2">
                    <div className="flex items-start gap-3">
                        <input 
                        type="checkbox" 
                        checked={topic.selected}
                        onChange={() => {
                            setTopics(topics.map(t => t.id === topic.id ? {...t, selected: !t.selected} : t));
                        }}
                        className="mt-1.5 w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer flex-shrink-0" 
                        />
                        <div className="flex-1">
                            <h4 className="font-bold text-gray-800 text-sm md:text-base">{topic.name}</h4>
                            <p className="text-xs text-gray-500 line-clamp-2">{topic.description}</p>
                        </div>
                    </div>
                    
                    {/* Difficulty Inputs */}
                    {topic.selected && (
                      <div className="grid grid-cols-4 gap-2 mt-1 ml-7">
                          <div>
                              <label className="block text-[10px] uppercase font-bold text-green-600 mb-0.5">Dễ</label>
                              <input 
                                type="number" min="0" 
                                value={topic.difficultyCounts[Difficulty.EASY]}
                                onChange={(e) => updateDifficultyCount(topic.id, Difficulty.EASY, parseInt(e.target.value))}
                                className="w-full text-center text-xs border border-green-200 rounded focus:border-green-500 outline-none py-1 bg-green-50"
                              />
                          </div>
                          <div>
                              <label className="block text-[10px] uppercase font-bold text-blue-600 mb-0.5">TB</label>
                              <input 
                                type="number" min="0" 
                                value={topic.difficultyCounts[Difficulty.MEDIUM]}
                                onChange={(e) => updateDifficultyCount(topic.id, Difficulty.MEDIUM, parseInt(e.target.value))}
                                className="w-full text-center text-xs border border-blue-200 rounded focus:border-blue-500 outline-none py-1 bg-blue-50"
                              />
                          </div>
                          <div>
                              <label className="block text-[10px] uppercase font-bold text-orange-600 mb-0.5">Khá</label>
                              <input 
                                type="number" min="0" 
                                value={topic.difficultyCounts[Difficulty.HARD]}
                                onChange={(e) => updateDifficultyCount(topic.id, Difficulty.HARD, parseInt(e.target.value))}
                                className="w-full text-center text-xs border border-orange-200 rounded focus:border-orange-500 outline-none py-1 bg-orange-50"
                              />
                          </div>
                          <div>
                              <label className="block text-[10px] uppercase font-bold text-red-600 mb-0.5">Khó</label>
                              <input 
                                type="number" min="0" 
                                value={topic.difficultyCounts[Difficulty.EXPERT]}
                                onChange={(e) => updateDifficultyCount(topic.id, Difficulty.EXPERT, parseInt(e.target.value))}
                                className="w-full text-center text-xs border border-red-200 rounded focus:border-red-500 outline-none py-1 bg-red-50"
                              />
                          </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {topics.length > 0 && (
                 <div className="mt-6 pt-4 border-t">
                    <button 
                        onClick={handleGenerate}
                        disabled={isGenerating || !pyodideReady}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white py-4 rounded-lg font-bold flex justify-center items-center gap-2 shadow-lg hover:shadow-xl transition-all"
                    >
                        {isGenerating ? <Loader2 className="animate-spin" /> : <Play />}
                        {pyodideReady ? "TẠO BÀI TẬP & VẼ HÌNH" : "ĐANG TẢI PYTHON..."}
                    </button>
                 </div>
              )}
           </div>
        </section>

        {/* Results Section */}
        {questions.length > 0 && (
           <section className="bg-white p-4 md:p-8 rounded-xl shadow-lg border border-blue-200">
               <div className="flex flex-col md:flex-row justify-between items-center border-b pb-4 mb-6 gap-4">
                   <h2 className="text-2xl font-bold text-blue-800">XEM TRƯỚC BÀI TẬP</h2>
                   <div className="flex flex-wrap gap-3">
                       <button onClick={handleAnalyze} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 flex items-center gap-2 text-sm font-medium">
                           <Settings size={16} /> Chọn lại chuyên đề
                       </button>
                       <button onClick={handleGenerate} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2 text-sm font-medium shadow">
                           <RefreshCw size={16} /> Phân tích lại (Khác input)
                       </button>
                       <button 
                           onClick={() => setShowAnswers(!showAnswers)} 
                           className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium shadow transition ${showAnswers ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                       >
                           {showAnswers ? <EyeOff size={16} /> : <Eye size={16} />} 
                           {showAnswers ? "Ẩn đáp án" : "Hiển thị đáp án"}
                       </button>
                       <button onClick={handleExport} className="px-6 py-2 bg-blue-700 text-white rounded-lg hover:bg-blue-800 shadow-md flex items-center gap-2 font-bold transition transform hover:scale-105">
                           <Download size={18} /> Xuất Word (.docx)
                       </button>
                   </div>
               </div>

               <div className="space-y-10">
                   {questions.map((q, index) => (
                       <div key={q.id} className="p-0 md:p-4 hover:bg-gray-50 rounded-lg transition border border-transparent hover:border-gray-200">
                           <div className="flex flex-col gap-2 mb-4">
                               <div className="flex md:items-baseline gap-2">
                                   <span className="font-bold text-blue-700 whitespace-nowrap text-lg">Câu {index + 1} <span className="text-sm font-normal text-gray-500">({q.difficulty})</span>:</span>
                                   <div className="flex-1">
                                       {/* Render Main Content */}
                                       <LatexPreview content={q.content} />
                                   </div>
                               </div>

                               {/* Main Question Image */}
                               {q.hasImage && (
                                   q.imageData ? <ImageWithRedraw id={q.id} imageData={q.imageData} /> : 
                                   <div className="flex items-center gap-3 text-gray-500 bg-gray-100 px-6 py-10 rounded-lg w-full max-w-md justify-center border-2 border-dashed border-gray-300 mx-auto">
                                       <Loader2 className="animate-spin text-blue-500" size={24} /> 
                                       <span>Đang xử lý hình ảnh...</span>
                                   </div>
                               )}

                               {/* Sub Questions (Parts a, b, c...) */}
                               {q.parts && q.parts.length > 0 && (
                                   <div className="ml-4 md:ml-10 mt-3 space-y-5">
                                       {q.parts.map((part) => (
                                           <div key={part.id} className="group">
                                               <div className="flex items-start gap-2">
                                                   <span className="font-bold text-gray-800 mt-1 min-w-[20px]">{part.label}</span>
                                                   <div className="flex-1">
                                                       <LatexPreview content={part.content} />
                                                   </div>
                                               </div>
                                               
                                               {part.hasImage && (
                                                    part.imageData ? <ImageWithRedraw id={part.id} parentId={q.id} imageData={part.imageData} /> : 
                                                    <div className="flex items-center gap-3 text-gray-500 bg-gray-100 px-4 py-6 rounded-lg w-full max-w-xs justify-center border-2 border-dashed border-gray-300 mx-auto mt-2">
                                                        <Loader2 className="animate-spin text-blue-500" size={20} /> 
                                                        <span className="text-sm">Hình ý {part.label}...</span>
                                                    </div>
                                               )}
                                           </div>
                                       ))}
                                   </div>
                               )}
                           </div>
                           
                           {/* Answers Section */}
                           {showAnswers && (
                               <div className="mt-3 ml-0 md:ml-12 p-3 bg-green-50 border-l-4 border-green-500 rounded-r shadow-sm">
                                   <div className="text-green-800 font-bold mb-2 flex items-center gap-2 border-b border-green-200 pb-1">
                                       <span>ĐÁP ÁN / LỜI GIẢI:</span>
                                   </div>
                                   <div className="text-gray-800 space-y-2">
                                       {/* Main Solution */}
                                       {q.solution && (
                                           <LatexPreview content={q.solution} />
                                       )}
                                       
                                       {/* Parts Solutions */}
                                       {q.parts && q.parts.map(part => (
                                           <div key={part.id} className="flex gap-2">
                                               <span className="font-bold text-green-700 min-w-[20px]">{part.label}</span>
                                               <div className="flex-1">
                                                    <LatexPreview content={part.solution || "(Đang cập nhật)"} />
                                               </div>
                                           </div>
                                       ))}
                                       
                                       {(!q.solution && (!q.parts || q.parts.length === 0)) && <span className="text-sm italic text-gray-500">(Chưa có dữ liệu lời giải)</span>}
                                   </div>
                               </div>
                           )}
                       </div>
                   ))}
               </div>
           </section>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-slate-800 text-slate-400 py-8 mt-12 border-t border-slate-700">
        <div className="max-w-7xl mx-auto text-center px-4">
            <h3 className="text-white font-bold text-lg mb-2">RA BÀI TẬP THEO CHUYÊN ĐỀ</h3>
            <p className="text-sm">Bản quyền thuộc về: <span className="text-blue-300">Lê Hoà Hiệp</span></p>
            <p className="text-sm">Hotline / Zalo: <span className="text-white">0983.676.470</span></p>
        </div>
      </footer>
    </div>
  );
}

export default App;