/** Every AI company gets one colour, used wherever its models appear (nodes, chips, tables). */
export type Provider = { key: string; name: string; color: string; soft: string; letter: string };

const P: Record<string, Provider> = {
  anthropic:    { key: "anthropic",  name: "Anthropic",  color: "#C2541B", soft: "#FBEEE6", letter: "A" },
  openai:       { key: "openai",     name: "OpenAI",     color: "#0E8A61", soft: "#E5F4EE", letter: "O" },
  google:       { key: "google",     name: "Google",     color: "#2563EB", soft: "#E8EFFD", letter: "G" },
  "meta-llama": { key: "meta-llama", name: "Meta",       color: "#7C3AED", soft: "#F1EAFD", letter: "M" },
  mistralai:    { key: "mistralai",  name: "Mistral",    color: "#CA8A04", soft: "#FBF4DD", letter: "Mi" },
  deepseek:     { key: "deepseek",   name: "DeepSeek",   color: "#4338CA", soft: "#ECEBFB", letter: "D" },
  "x-ai":       { key: "x-ai",       name: "xAI",        color: "#334155", soft: "#ECEFF3", letter: "X" },
  qwen:         { key: "qwen",       name: "Qwen",       color: "#DB2777", soft: "#FCE8F2", letter: "Q" },
  moonshotai:   { key: "moonshotai", name: "Moonshot",   color: "#0891B2", soft: "#E3F4F8", letter: "K" },
  elevenlabs:   { key: "elevenlabs", name: "ElevenLabs", color: "#1F2937", soft: "#EDEEF0", letter: "11" },
  human:        { key: "human",      name: "You",        color: "#B45309", soft: "#FDF3E4", letter: "H" },
};
const OTHER: Provider = { key: "other", name: "Other", color: "#6B7280", soft: "#EFF0F2", letter: "•" };

export function providerOf(modelOrTool?: string | null): Provider {
  const m = (modelOrTool ?? "").toLowerCase();
  if (!m) return OTHER;
  if (m === "human") return P.human;
  if (m.startsWith("elevenlabs")) return P.elevenlabs;
  return P[m.split("/")[0]] ?? OTHER;
}

/** "anthropic/claude-sonnet-5.5" -> "claude-sonnet-5.5" */
export const shortModel = (m?: string | null) => (m ?? "").split("/").pop() ?? "";
