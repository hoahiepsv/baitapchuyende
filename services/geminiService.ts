import { GoogleGenAI } from "@google/genai";
import { ModelType, Topic, Question, Difficulty } from "../types";

let genAI: GoogleGenAI | null = null;

export const initializeGemini = (apiKey: string) => {
  genAI = new GoogleGenAI({ apiKey });
};

const getAI = () => {
  if (!genAI) throw new Error("API Key not set");
  return genAI;
};

// Helper to safely parse JSON from AI response, handling common LaTeX escape errors
const safeJsonParse = (text: string): any => {
  // 1. Remove Markdown code blocks
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 2. Fallback: Attempt to fix invalid backslashes
    const invalidEscapeRegex = /\\(?!["\\/bfnrtu]|u[0-9a-fA-F]{4})/g;
    const fixed = cleaned.replace(invalidEscapeRegex, '\\\\');
    
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      console.error("JSON Parse failed even after cleaning. Original:", text);
      console.error("Fixed attempt:", fixed);
      return [];
    }
  }
};

// Advanced code cleaning to fix common AI Python generation errors
const cleanPythonCode = (code: string): string => {
  if (!code) return "";
  
  let cleaned = code.replace(/```python/g, '').replace(/```/g, '').trim();

  cleaned = cleaned.replace(/r'([^']*)'/g, (match, content) => {
      return "r'" + content.replace(/\n/g, ' ') + "'";
  });
  
  cleaned = cleaned.replace(/r"([^"]*)"/g, (match, content) => {
      return 'r"' + content.replace(/\n/g, ' ') + '"';
  });

  cleaned = cleaned.replace(/'([^']*)'/g, (match, content) => {
      if (content.includes('$') || content.includes('\\')) {
          return "'" + content.replace(/\n/g, ' ') + "'";
      }
      return match;
  });

  return cleaned;
};

export const analyzeTopics = async (
  distributionText: string,
  bankText: string,
  manualTopic: string,
  modelName: ModelType
): Promise<Topic[]> => {
  const ai = getAI();
  
  const prompt = `
    Phân tích dữ liệu đầu vào sau đây để lên kế hoạch ra bài tập toán học.
    
    DỮ LIỆU 1: PHÂN PHỐI CHƯƠNG TRÌNH (Phạm vi kiến thức cần dạy):
    ${distributionText.substring(0, 15000)}
    
    DỮ LIỆU 2: NGÂN HÀNG CÂU HỎI / ĐỀ CƯƠNG (Mẫu bài tập):
    ${bankText.substring(0, 15000)}

    ${manualTopic ? `DỮ LIỆU 3: YÊU CẦU THỦ CÔNG CỦA GIÁO VIÊN: "${manualTopic}"` : ""}

    LƯU Ý: Kết hợp kiến thức từ các file input và kiến thức toán học của bạn (tương tự tìm kiếm internet) để đưa ra danh sách chuyên đề đầy đủ nhất.
    Nếu có "Yêu cầu thủ công", hãy ưu tiên phân tích kỹ nội dung đó.

    Nhiệm vụ: Trích xuất và phân loại các CHUYÊN ĐỀ (Topics) toán học chính phù hợp để ra bài kiểm tra/bài tập.
    
    Trả về định dạng JSON thuần túy (không markdown).
    Schema:
    [
      {
        "id": "unique_string_id",
        "name": "Tên chuyên đề (Ví dụ: Hàm số lũy thừa)",
        "description": "Mô tả ngắn gọn phạm vi kiến thức"
      }
    ]
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });
    
    const text = response.text || "[]";
    const rawTopics = safeJsonParse(text);
    
    if (!Array.isArray(rawTopics)) return [];

    return rawTopics.map((t: any) => ({ 
      ...t, 
      selected: true, 
      difficultyCounts: {
        [Difficulty.EASY]: 1,
        [Difficulty.MEDIUM]: 2,
        [Difficulty.HARD]: 1,
        [Difficulty.EXPERT]: 1
      }
    }));
  } catch (error) {
    console.error("Error analyzing topics:", error);
    return [];
  }
};

export const generateQuestions = async (
  topics: Topic[],
  manualTopic: string,
  contextData: string,
  modelName: ModelType
): Promise<Question[]> => {
  const ai = getAI();
  const activeTopics = topics.filter(t => t.selected);
  
  if (activeTopics.length === 0 && !manualTopic) return [];

  // Build request string with question counts per difficulty
  const topicRequests = activeTopics.map(t => {
     const counts = t.difficultyCounts;
     return `- ${t.name}: ${counts[Difficulty.EASY]} câu Dễ, ${counts[Difficulty.MEDIUM]} câu Trung bình, ${counts[Difficulty.HARD]} câu Khá, ${counts[Difficulty.EXPERT]} câu Khó.`;
  }).join("\n");
  
  const prompt = `
    Bạn là chuyên gia giáo dục và lập trình viên Python Toán học.
    Hãy tạo bộ câu hỏi toán học dựa trên yêu cầu dưới đây.
    
    DỮ LIỆU THAM KHẢO (ĐỂ CLONE DẠNG BÀI, NHƯNG THAY SỐ/DỮ LIỆU):
    ${contextData.substring(0, 20000)}

    DANH SÁCH CHUYÊN ĐỀ CẦN RA VÀ SỐ LƯỢNG CHI TIẾT:
    ${topicRequests}
    ${manualTopic ? `Bổ sung thêm chuyên đề ngoài theo yêu cầu thủ công: ${manualTopic} (Tự phân phối mức độ hợp lý)` : ""}

    YÊU CẦU QUAN TRỌNG VỀ CẤU TRÚC:
    1. GỘP CÂU HỎI: Nếu có các bài toán ngắn có CÙNG YÊU CẦU (Ví dụ: cùng là "Giải phương trình", "Phân tích đa thức", "Tính"), hãy tạo thành 1 Câu hỏi lớn có các ý nhỏ a), b), c)... thay vì tách rời.
       Ví dụ: 
       Câu 1: Giải các phương trình sau:
       a) $x^2 - 1 = 0$
       b) $x^2 + 2x = 0$
    2. Tuân thủ số lượng câu hỏi.
    3. Thay đổi số liệu so với bài mẫu.
    
    QUY TẮC HIỂN THỊ TOÁN HỌC (QUAN TRỌNG):
    1. Mọi công thức toán, biểu thức, biến số (x, y, z...) PHẢI ĐƯỢC BAO QUANH bởi dấu đô la ($).
       - SAI: Giải phương trình x^2 + 2x = 0
       - ĐÚNG: Giải phương trình $x^2 + 2x = 0$
       - SAI: Cho tam giác ABC vuông tại A
       - ĐÚNG: Cho tam giác $ABC$ vuông tại $A$
    2. Trong JSON String, dấu backslash (\\) phải được nhân đôi (\\\\).
       - Ví dụ: "$\\\\frac{1}{2}$", "$\\\\sqrt{x}$", "$\\\\in$", "$\\\\widehat{ABC}$".
    3. Dùng môi trường 'align' nếu cần căn lề nhiều dòng.
    4. TUYỆT ĐỐI KHÔNG dùng TikZ.
    
    QUY TẮC PYTHON VẼ HÌNH (Matplotlib):
    1. KHÔNG ngắt dòng trong chuỗi.
    2. Hình 3D: projection='3d', ax.view_init().
    
    Trả về định dạng JSON List (Mảng).
    Schema:
    [
      {
        "id": "uuid",
        "topicId": "topic_id_ref",
        "content": "Nội dung/Yêu cầu chính (Ví dụ: 'Phân tích các đa thức sau thành nhân tử:')",
        "difficulty": "Dễ" | "Trung bình" | "Khá" | "Khó",
        "hasImage": true/false (cho câu chính),
        "pythonCode": "Code python (nếu có)",
        "solution": "Lời giải chung (hoặc để trống nếu giải chi tiết ở phần parts)",
        "parts": [
            {
               "id": "uuid_part",
               "label": "a)", // a), b), c)...
               "content": "Nội dung ý nhỏ (Ví dụ: '$x^3 - 8$')",
               "hasImage": true/false,
               "pythonCode": "Code python riêng (nếu có)",
               "solution": "Đáp án/Lời giải chi tiết cho ý này"
            }
        ] (Có thể null hoặc rỗng nếu là câu hỏi đơn)
      }
    ]
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text || "[]";
    const questions = safeJsonParse(text);
    
    if (!Array.isArray(questions)) return [];

    return questions.map((q: any) => ({
        ...q,
        pythonCode: q.pythonCode ? cleanPythonCode(q.pythonCode) : undefined,
        parts: q.parts ? q.parts.map((p: any) => ({
             ...p,
             pythonCode: p.pythonCode ? cleanPythonCode(p.pythonCode) : undefined
        })) : undefined
    }));

  } catch (error) {
    console.error("Error generating questions:", error);
    throw error;
  }
};

export const fixImageCode = async (
  originalCode: string,
  instruction: string,
  questionContent: string,
  modelName: ModelType
): Promise<string> => {
    const ai = getAI();
    const prompt = `
      Tôi có đoạn code Python Matplotlib vẽ hình cho bài toán này:
      "${questionContent}"
      
      Code hiện tại:
      \`\`\`python
      ${originalCode}
      \`\`\`
      
      YÊU CẦU VẼ LẠI TỪ NGƯỜI DÙNG: "${instruction}"
      
      Hãy viết lại đoạn code Python.
      
      CHỈ DẪN KỸ THUẬT:
      1. Xử lý hình 3D: Chỉnh ax.view_init(elev=..., azim=...) nếu cần xoay.
      2. CẤM NGẮT DÒNG TRONG CHUỖI.
      3. Giữ nguyên style Matplotlib.
    `;

    const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
    });

    return cleanPythonCode(response.text || "");
}