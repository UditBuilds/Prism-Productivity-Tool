import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const geminiFlash = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

// TODO Session 5: generateFlashcardsFromNote(noteContent: string)
// Will parse note content and return array of {front, back} pairs

export default geminiFlash;
