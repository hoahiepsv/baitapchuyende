export enum ModelType {
  FLASH = 'gemini-2.5-flash', // Nhanh
  PRO = 'gemini-3-pro-preview', // Thông minh
}

export enum Difficulty {
  EASY = 'Dễ',
  MEDIUM = 'Trung bình',
  HARD = 'Khá',
  EXPERT = 'Khó',
}

export interface Topic {
  id: string;
  name: string;
  description: string;
  selected: boolean;
  difficultyCounts: {
    [key in Difficulty]: number;
  };
}

export interface SubQuestion {
  id: string;
  label: string; // a), b), c)...
  content: string; // The specific expression/problem
  solution: string; // Solution for this part
  hasImage: boolean;
  pythonCode?: string;
  imageData?: string;
}

export interface Question {
  id: string;
  topicId: string;
  content: string; // Main requirement (e.g. "Giải các phương trình:")
  parts?: SubQuestion[]; // Optional sub-questions
  solution: string; // General solution or empty
  difficulty: Difficulty;
  hasImage: boolean;
  pythonCode?: string; // Main image
  imageData?: string; // Main image data
}

export interface GeneratedContent {
  questions: Question[];
}

export interface FileData {
  id: string;
  name: string;
  content: string; // Text extracted or base64
  category: 'distribution' | 'bank'; // Category of input
}