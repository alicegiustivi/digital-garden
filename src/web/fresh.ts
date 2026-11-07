// Objects the owner just made on purpose (a Thought started from two Objects): the page opens ready to write.
const made = new Set<string>();
export const markMade = (id: string) => void made.add(id);
export const wasMadeHere = (id: string) => made.has(id);
