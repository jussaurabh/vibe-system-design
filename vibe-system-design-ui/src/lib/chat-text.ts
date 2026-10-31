export function stripUserPromptTags(text: string): string {
  const match = text.match(/^\s*<user_prompt>\s*([\s\S]*?)\s*<\/user_prompt>\s*$/);
  return match ? match[1] : text;
}