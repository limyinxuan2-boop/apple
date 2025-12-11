
import { GoogleGenAI } from "@google/genai";
import { AppSettings } from '../types';

// Helper to replace template variables
export const interpolatePrompt = (
  template: string, 
  variables: Record<string, string>
): string => {
  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(`{${key}}`, 'g'), value || '');
  });
  return result;
};

// --- OpenAI Compatible Fallback ---
const fetchOpenAICompatible = async (
    messages: { role: string; content: string }[],
    settings: AppSettings,
    systemPrompt?: string
) => {
    const apiKey = settings.apiKey || process.env.API_KEY;
    if (!apiKey) throw new Error("API Key missing");

    let endpoint = settings.apiUrl || "https://api.openai.com/v1/chat/completions";
    
    // Intelligent URL construction
    if (!endpoint.includes('/chat/completions') && !endpoint.includes('generateContent')) {
        // If it looks like a base URL (no specific endpoint path)
        endpoint = endpoint.replace(/\/+$/, ''); // Remove trailing slash
        if (endpoint.endsWith('/v1')) {
            endpoint = `${endpoint}/chat/completions`;
        } else {
            endpoint = `${endpoint}/v1/chat/completions`;
        }
    }

    console.log("⚠️ SDK failed. Falling back to OpenAI Protocol:", endpoint);

    // Transform messages to OpenAI format
    const openAIMessages = [];
    if (systemPrompt) {
        openAIMessages.push({ role: 'system', content: systemPrompt });
    }
    
    messages.forEach(m => {
        if (m.role === 'system') return; 
        openAIMessages.push({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content
        });
    });

    const body = {
        model: settings.model || 'gpt-3.5-turbo',
        messages: openAIMessages,
        stream: false,
        temperature: 0.7
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error("OpenAI Fetch Error Body:", errText);
            throw new Error(`Protocol Error: ${response.status} - ${errText.slice(0, 50)}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    } catch (e: any) {
        console.error("Fetch failed details:", e);
        throw e;
    }
};

export const generateChatCompletion = async (
  messages: { role: string; content: string }[],
  settings: AppSettings
) => {
    // Extract system prompt first
    const systemMessage = messages.find(m => m.role === 'system');
    const systemContent = systemMessage ? systemMessage.content : undefined;
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // 1. Try Google GenAI SDK First
    try {
        const apiKey = settings.apiKey || process.env.API_KEY;
        if (!apiKey) throw new Error("API Key not found.");

        const baseUrl = settings.apiUrl || undefined;
        
        // If baseUrl is clearly an OpenAI proxy (contains v1 but not googleapis), skip SDK and go straight to fallback
        if (baseUrl && baseUrl.includes('/v1') && !baseUrl.includes('googleapis')) {
             throw new Error("Detected OpenAI-compatible URL, skipping SDK.");
        }

        const ai = new GoogleGenAI({ apiKey, baseUrl });
        
        const contents = conversationMessages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        const modelName = settings.model || 'gemini-1.5-flash';

        const response = await ai.models.generateContent({
            model: modelName,
            contents: contents,
            config: {
                systemInstruction: systemContent,
            }
        });

        return response.text;

    } catch (googleError: any) {
        // 2. Fallback to OpenAI Compatible Fetch
        if (settings.apiUrl || googleError.message.includes('Detected OpenAI')) {
            try {
                return await fetchOpenAICompatible(messages, settings, systemContent);
            } catch (fallbackError: any) {
                console.error("Fallback also failed:", fallbackError);
                throw new Error(`Connection Failed: ${fallbackError.message || 'Check Network'}`);
            }
        }
        
        throw new Error("Connection Failed. Please check API Key and Settings.");
    }
};

export const fetchModels = async (settings: AppSettings): Promise<string[]> => {
  const apiKey = settings.apiKey || process.env.API_KEY;
  if (!apiKey) throw new Error("请先填写 API Key");

  // Strategy 1: Google SDK / Official Endpoint
  try {
      let baseUrl = settings.apiUrl || "https://generativelanguage.googleapis.com";
      baseUrl = baseUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/v1beta/models?key=${apiKey}`;
      
      // Skip if it looks like an OpenAI proxy
      if (baseUrl.includes('/v1') && !baseUrl.includes('googleapis')) {
          throw new Error("Skipping Google fetch for OpenAI proxy");
      }

      console.log("Fetching models (Google Protocol):", url);
      const response = await fetch(url);
      if (response.ok) {
          const data = await response.json();
          if (data.models && Array.isArray(data.models)) {
              return data.models
                  .map((m: any) => m.name.replace(/^models\//, ''))
                  .filter((name: string) => name.toLowerCase().includes('gemini'));
          }
      }
  } catch (e) {
      console.warn("Google Model Fetch failed:", e);
  }

  // Strategy 2: OpenAI Compatible Endpoint
  try {
      let baseUrl = settings.apiUrl || "https://api.openai.com";
      baseUrl = baseUrl.replace(/\/+$/, '');
      let endpoint = baseUrl;
      if (!baseUrl.includes('/models')) {
          if (baseUrl.endsWith('/v1')) endpoint = `${baseUrl}/models`;
          else endpoint = `${baseUrl}/v1/models`;
      }

      console.log("Fetching models (OpenAI Protocol):", endpoint);
      const response = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      if (response.ok) {
          const data = await response.json();
          if (data.data && Array.isArray(data.data)) {
              return data.data.map((m: any) => m.id);
          }
      }
  } catch (e) {
      console.warn("OpenAI Model Fetch failed:", e);
  }

  // Fallback List if all network requests fail
  return [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash-exp',
    'gpt-3.5-turbo',
    'gpt-4o'
  ];
}
