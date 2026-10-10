/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type WordCategory = 'reading' | 'writing' | 'speaking' | 'listening';

export interface IELTSWord {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  chinese: string;
  definition: string;
  example: string;
  exampleTranslation: string;
  category: WordCategory;
  topic: string;
  custom?: boolean;
  sourceMaterialId?: string;
  sourceMaterialName?: string;
  sourceSentence?: string;
  userNotes?: string;
  allMeanings?: { partOfSpeech: string; chinese: string; definition?: string }[];
  collocations?: { phrase: string; translation: string; example?: string }[];
}

export type MaterialType = 'audio' | 'document' | 'video' | 'link';

export interface StudyMaterial {
  transcriptionReport?: string;
  id: string;
  name: string;
  type: MaterialType;
  category: WordCategory;
  url?: string;         // External URL or Local object URL
  content: string;      // Content of the document, transcript of the audio/video, or link text
  notes: string;        // User's study notes
  summary?: string;     // AI-generated summary of key knowledge points
  sentences?: string[]; // Accurate word-by-word / sentence-by-sentence text split for dictation
  timestamp: string;
  folderId?: string;    // Belongs to a specific folder
  videoSubtitles?: {
    id: string;
    start: number;
    end: number;
    text: string;
    translation: string;
  }[];
}

export interface MaterialFolder {
  id: string;
  name: string;
  category: WordCategory;
  createdAt: string;
}

export type ProgressStatus = 'new' | 'learning' | 'familiar' | 'mastered';

export interface WordProgress {
  wordId: string;
  box: number; // 1 to 5 in Leitner Spaced Repetition System
  nextReviewDate: string; // ISO Date String
  status: ProgressStatus;
  lastReviewed?: string;
  starred: boolean;
  timesReviewed: number;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  wordsReviewed: number;
  wordsLearned: number;
  minutesSpent: number;
  correctAnswers: number;
  totalAnswers: number;
}

export interface QuizQuestion {
  id: string;
  type: 'multiple-choice' | 'spelling' | 'dictation';
  word: IELTSWord;
  prompt: string;
  options?: string[]; // Used for multiple choice
  correctAnswer: string;
  userAnswer?: string;
  isCorrect?: boolean;
}

export interface AISessionHistory {
  wordId: string;
  promptType: 'mnemonic' | 'writing' | 'speaking' | 'chat';
  query?: string;
  response: string;
  timestamp: string;
}
