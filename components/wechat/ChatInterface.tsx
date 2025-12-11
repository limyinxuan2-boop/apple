

import React, { useState, useEffect, useRef, Dispatch, SetStateAction, useMemo } from 'react';
import { Character, Message, AppSettings, Moment, Scenario, MemoryCard, StyleConfig } from '../../types';
import { generateChatCompletion, interpolatePrompt } from '../../services/aiService';
import { ARCHIVIST_PROMPT, FUSE_PROMPT, DEFAULT_OS_PROMPT, OFFLINE_LOADING_COLORS, DEFAULT_OFFLINE_PROMPT, PRESET_STYLES, DEFAULT_STYLE_CONFIG } from '../../constants';

interface ChatInterfaceProps {
  character: Character;
  settings: AppSettings;
  onBack: () => void;
  onUpdateCharacter: (charOrFn: Character | ((prev: Character) => Character)) => void;
  onAddMessage: (charId: string, message: Message) => void;
  isGlobalGenerating: boolean;
  setGlobalGenerating: (isGenerating: boolean) => void;
  onShowNotification?: (text: string) => void; 
  onPostMoment?: (content: string, images?: string[]) => void;
}

type ViewMode = 'chat' | 'offline' | 'theater_list' | 'theater_room';
type UserTool = 'LOCATION' | 'TRANSFER' | 'VOICE' | 'PHOTO' | null;

// --- HELPER: Aggressive Image Compression ---
const compressImage = (file: File, maxWidth = 600, quality = 0.5): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                // Return Data URL
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

// --- HELPER: Extract INNER content from a string ---
const extractInnerContent = (text: string): { inner: string | undefined, clean: string } => {
    if (!text) return { inner: undefined, clean: '' };
    
    // Match [INNER: ...]
    const bracketMatch = text.match(/\[INNER:([\s\S]*?)\]/i);
    if (bracketMatch) {
        const innerContent = bracketMatch[1].trim();
        return {
            inner: innerContent.length > 0 ? innerContent : undefined,
            clean: text.replace(bracketMatch[0], '').trim()
        };
    }
    
    // Match <os> ... </os> (Legacy support)
    const tagMatch = text.match(/<os>([\s\S]*?)<\/os>/i);
    if (tagMatch) {
        const innerContent = tagMatch[1].trim();
        return {
            inner: innerContent.length > 0 ? innerContent : undefined,
            clean: text.replace(tagMatch[0], '').trim()
        };
    }

    return { inner: undefined, clean: text };
};

// --- HELPER: Clean Markdown Code Blocks ---
const cleanMarkdown = (text: string): string => {
    let clean = text.trim();
    if (clean.startsWith('```')) {
        clean = clean.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '');
    }
    return clean.trim();
};

// --- HELPER: Format Legacy JSON Messages ---
const formatLegacyMessage = (content: string): string => {
    const trimmed = content.trim();
    // Check if it looks like a JSON array ["msg1", "msg2"]
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && !trimmed.includes('INNER:')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                // Filter out non-string items just in case, or stringify them
                return parsed.map(item => typeof item === 'string' ? item : '').filter(Boolean).join('\n');
            }
        } catch (e) {
            // Not valid JSON, return original
        }
    }
    return content;
};

const LoadingBubbles = ({ color }: { color?: string }) => (
  <div className="flex space-x-1 items-center bg-stone-800/80 px-4 py-2 rounded-full w-fit animate-fade-in border border-stone-600">
    <div className="w-2 h-2 rounded-full animate-bounce [animation-delay:-0.3s]" style={{ backgroundColor: color || '#f59e0b' }}></div>
    <div className="w-2 h-2 rounded-full animate-bounce [animation-delay:-0.15s]" style={{ backgroundColor: color || '#f59e0b' }}></div>
    <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: color || '#f59e0b' }}></div>
    <span className="text-xs text-stone-400 ml-2 font-serif">对方正在行动中...</span>
  </div>
);

const parseStyleString = (styleStr?: string): React.CSSProperties => {
    if (!styleStr) return {};
    const style: any = {};
    styleStr.split(';').forEach(rule => {
        const [key, value] = rule.split(':');
        if (key && value) {
            const camelKey = key.trim().replace(/-([a-z])/g, g => g[1].toUpperCase());
            style[camelKey] = value.trim();
        }
    });
    return style;
};

const useLongPress = (callback: (e: any) => void, ms = 500) => {
  const [startLongPress, setStartLongPress] = useState(false);
  const timerId = useRef<any>(null);

  const start = (e: any) => {
    setStartLongPress(true);
    timerId.current = setTimeout(() => { callback(e); }, ms);
  };

  const stop = () => {
    setStartLongPress(false);
    clearTimeout(timerId.current);
  };

  return { onMouseDown: start, onMouseUp: stop, onMouseLeave: stop, onTouchStart: start, onTouchEnd: stop };
};

interface ParsedAIResponse {
    messages: Message[];
    retracts: { id: string, delay: number }[];
    transferAction?: 'received' | 'refunded';
    moments: { content: string, images?: string[] }[];
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ character, settings, onBack, onUpdateCharacter, onAddMessage, isGlobalGenerating, setGlobalGenerating, onShowNotification, onPostMoment }) => {
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showMemoryFurnace, setShowMemoryFurnace] = useState(false);
  const [showCharSettings, setShowCharSettings] = useState(false);
  const [showOfflineSettings, setShowOfflineSettings] = useState(false);
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const [showOSModal, setShowOSModal] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [isCreatingScenario, setIsCreatingScenario] = useState(false);
  const [newScenario, setNewScenario] = useState<Partial<Scenario>>({});
  const [showScenarioSettings, setShowScenarioSettings] = useState(false);
  const [tempCharConfig, setTempCharConfig] = useState<Character>(character);
  const [contextMenuMsgId, setContextMenuMsgId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [quotingMsg, setQuotingMsg] = useState<Message | null>(null);
  
  // User Tool States
  const [activeToolModal, setActiveToolModal] = useState<UserTool>(null);
  const [toolData, setToolData] = useState({
      location: '',
      transferAmount: '',
      transferNote: '大吉大利，万事如意',
      voiceText: '',
      photoDesc: '',
      photoType: 'UPLOAD' as 'UPLOAD' | 'DESC'
  });
  
  // Transfer Interaction State
  const [transferActionMsg, setTransferActionMsg] = useState<Message | null>(null);

  // Lazy Loading State
  const [visibleLimit, setVisibleLimit] = useState(character.renderMessageLimit || 50);

  // New state for Inner Monologue Modal
  const [activeInnerContent, setActiveInnerContent] = useState<string | null>(null);
  const [innerDarkMode, setInnerDarkMode] = useState(false);

  // New state for Photo Description Modal
  const [photoDescription, setPhotoDescription] = useState<string | null>(null);
  const [viewingImage, setViewingImage] = useState<string | null>(null); // For real images

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeScenario = character.scenarios?.find(s => s.id === activeScenarioId);

  // Force update visibleLimit when settings change
  useEffect(() => {
    if (character.renderMessageLimit) {
        setVisibleLimit(character.renderMessageLimit);
    }
  }, [character.renderMessageLimit]);

  const scrollToBottom = () => { 
      // Add timeout to ensure DOM is ready, especially for offline/theater modes
      setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); 
      }, 150);
  };
  
  // Only scroll to bottom on new messages, typing status change, or view mode change.
  // We do NOT include visibleLimit here to prevent jumping when loading history.
  useEffect(() => { scrollToBottom(); }, [character.messages.length, isTyping, viewMode, activeScenarioId]);
  
  useEffect(() => { setTempCharConfig(character); }, [character]);

  const currentUserAvatar = character.useLocalPersona ? (character.userMaskAvatar || 'https://ui-avatars.com/api/?name=U') : settings.globalPersona.avatar;
  const currentUserName = character.useLocalPersona ? character.userMaskName : settings.globalPersona.name;
  const currentUserDesc = character.useLocalPersona ? character.userMaskDescription : settings.globalPersona.description;

  // --- Logic ---

  const handleToolSend = async () => {
      let newMessage: Message | null = null;
      const baseMsg = {
          id: Date.now().toString(),
          role: 'user' as const,
          timestamp: Date.now(),
          mode: viewMode === 'offline' ? 'offline' as const : (viewMode === 'theater_room' ? 'theater' as const : 'online' as const),
          scenarioId: activeScenarioId || undefined,
      };

      if (activeToolModal === 'LOCATION') {
          if (!toolData.location) return;
          newMessage = { ...baseMsg, content: toolData.location, msgType: 'location' };
      } 
      else if (activeToolModal === 'TRANSFER') {
          const amount = parseFloat(toolData.transferAmount);
          if (isNaN(amount) || amount <= 0) { alert('请输入有效金额'); return; }
          newMessage = { 
              ...baseMsg, 
              content: toolData.transferNote, 
              msgType: 'transfer', 
              meta: { amount: amount, status: 'pending' } // Default pending
          };
      }
      else if (activeToolModal === 'VOICE') {
          if (!toolData.voiceText) return;
          // Calculate roughly 3 chars per second, min 1 sec
          const duration = Math.max(1, Math.ceil(toolData.voiceText.length / 3));
          newMessage = {
              ...baseMsg,
              content: '[语音]',
              msgType: 'voice',
              meta: { textContent: toolData.voiceText, duration: duration }
          };
      }
      else if (activeToolModal === 'PHOTO') {
          // Photo is handled separately in tabs
          if (toolData.photoType === 'DESC') {
              if (!toolData.photoDesc) return;
              newMessage = { ...baseMsg, content: toolData.photoDesc, msgType: 'image' };
          }
      }

      if (newMessage) {
          onAddMessage(character.id, newMessage);
          
          if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
              // Handle Theater Isolated State
              onUpdateCharacter(prev => {
                const updatedScenarios = prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: [...(s.messages || []), newMessage!] } : s) || [];
                return { ...prev, scenarios: updatedScenarios };
              });
          }

          setActiveToolModal(null);
          setShowDrawer(false);
          setToolData({ location: '', transferAmount: '', transferNote: '大吉大利，万事如意', voiceText: '', photoDesc: '', photoType: 'UPLOAD' });
          
          // NOTE: Removed fetchAIReply here. User must manually trigger AI or send another message.
          // This allows "Stacking" messages.
      }
  };

  const handleUserPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          try {
              const compressed = await compressImage(file, 600, 0.6);
              const newMessage: Message = {
                  id: Date.now().toString(),
                  role: 'user',
                  timestamp: Date.now(),
                  mode: viewMode === 'offline' ? 'offline' : (viewMode === 'theater_room' ? 'theater' : 'online'),
                  scenarioId: activeScenarioId || undefined,
                  content: compressed, // Base64 string as content
                  msgType: 'image'
              };
              
              onAddMessage(character.id, newMessage);
              
              if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
                  onUpdateCharacter(prev => {
                    const updatedScenarios = prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: [...(s.messages || []), newMessage] } : s) || [];
                    return { ...prev, scenarios: updatedScenarios };
                  });
              }

              setActiveToolModal(null);
              setShowDrawer(false);
              
              // NOTE: Removed fetchAIReply here as well.

          } catch (err) {
              alert("图片处理失败");
          }
      }
  };

  const handleTransferStatusUpdate = (status: 'received' | 'refunded') => {
      if (!transferActionMsg) return;

      const updateLogic = (msgs: Message[]) => msgs.map(m => {
          if (m.id === transferActionMsg.id) {
              return { 
                  ...m, 
                  meta: { ...m.meta, status: status } 
              };
          }
          return m;
      });

      if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
          onUpdateCharacter(prev => ({ 
              ...prev, 
              scenarios: prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: updateLogic(s.messages || []) } : s) 
          }));
      } else {
          onUpdateCharacter(prev => ({ ...prev, messages: updateLogic(prev.messages) }));
      }
      
      setTransferActionMsg(null);
  };

  const handleCreateScenario = () => {
      if (!newScenario.title) return;
      const scenario: Scenario = {
          id: Date.now().toString(),
          title: newScenario.title,
          description: newScenario.description || '',
          systemPrompt: newScenario.systemPrompt || '这是一个全新的剧场世界。',
          isConnected: newScenario.isConnected ?? true,
          wallpaper: '',
          contextMemory: '',
          messages: []
      };
      onUpdateCharacter(prev => ({ ...prev, scenarios: [scenario, ...(prev.scenarios || [])] }));
      setIsCreatingScenario(false);
      setNewScenario({});
  };

  const handleDeleteScenario = (id: string) => {
      if (!window.confirm("确定删除该剧场吗？")) return;
      onUpdateCharacter(prev => ({ ...prev, scenarios: (prev.scenarios || []).filter(s => s.id !== id) }));
      if (activeScenarioId === id) setViewMode('theater_list');
  };

  const updateActiveScenario = (updates: Partial<Scenario>) => {
      if (!activeScenarioId) return;
      onUpdateCharacter(prev => ({ ...prev, scenarios: (prev.scenarios || []).map(s => s.id === activeScenarioId ? { ...s, ...updates } : s) }));
  };

  const exitTheater = () => {
      if (activeScenario) {
           // Inject a hidden system message to force style reset
           const exitMsg: Message = {
              id: Date.now().toString(),
              role: 'system',
              content: `[系统通知：用户已离开剧场模式“${activeScenario.title}”，回到了标准微信界面。请立即切断剧场设定的叙事风格，强制恢复正常微信聊天模式。1.停止描写动作/环境。2.仅发送纯文本对话。3.恢复短句。]`,
              timestamp: Date.now(),
              mode: 'online',
              isHidden: true
           };
           onAddMessage(character.id, exitMsg);
      }
      setActiveScenarioId(null);
      setViewMode('theater_list');
  };

  const exitOfflineMode = () => {
      // Inject a hidden system message to force style reset
      // This solves the issue where AI keeps replying in offline/novel style after returning to chat
      const exitMsg: Message = {
          id: Date.now().toString(),
          role: 'system',
          content: `[系统通知：用户已结束“线下见面/现实模式”，回到了手机微信界面。请立即切换回【线上聊天模式】。1.停止一切环境、动作、神态描写。2.仅发送气泡对话内容。3.恢复短句和网聊风格。]`,
          timestamp: Date.now(),
          mode: 'online',
          isHidden: true
      };
      onAddMessage(character.id, exitMsg);
      setViewMode('chat');
  };

  const handleSend = async (getReply: boolean, customContent?: string) => {
    if (isGlobalGenerating) return;
    if (getReply && !settings.apiKey) { alert("请先在【设置】中配置 API Key。"); return; }
    
    const contentToSend = customContent || inputValue.trim();
    if (!contentToSend && !getReply) return; 
    
    let updatedCharForAI = { ...character }; 

    if (contentToSend) {
        const newMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: contentToSend,
            timestamp: Date.now(),
            mode: viewMode === 'offline' ? 'offline' : (viewMode === 'theater_room' ? 'theater' : 'online'),
            scenarioId: activeScenarioId || undefined,
            quote: quotingMsg ? { id: quotingMsg.id, content: quotingMsg.content, name: quotingMsg.role === 'model' ? character.remark : '我' } : undefined
        };

        if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
            onUpdateCharacter(prev => {
                const updatedScenarios = prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: [...(s.messages || []), newMessage] } : s) || [];
                updatedCharForAI = { ...prev, scenarios: updatedScenarios };
                return { ...prev, scenarios: updatedScenarios };
            });
        } else {
            onAddMessage(character.id, newMessage);
            // We must update our local state to pass the freshest data to fetchAIReply
            updatedCharForAI = { ...character, messages: [...character.messages, newMessage] }; 
        }
        setInputValue('');
        setQuotingMsg(null);
        setShowDrawer(false); 
    }

    if (getReply) {
      setIsTyping(true);
      setGlobalGenerating(true); 
      // Use the updated char object which definitely contains the user's latest message
      try { await fetchAIReply(updatedCharForAI); } catch (e) { console.error(e); setIsTyping(false); setGlobalGenerating(false); }
    }
  };

  const handleForceMoment = () => {
      const newMoment: Moment = {
          id: Date.now().toString(),
          authorId: character.id,
          content: "📸 这是一条强制生成的测试朋友圈。\n(如果看到这条消息，说明显示功能正常，AI 只要发指令就能显示)",
          timestamp: Date.now(),
          likes: [],
          comments: []
      };
      onUpdateCharacter(prev => ({ ...prev, moments: [newMoment, ...(prev.moments || [])] }));
      if (onShowNotification) onShowNotification(`${character.remark} 发布了朋友圈 (测试)`);
      setShowDrawer(false);
  };

  const handlePat = () => {
      const patMsg: Message = {
          id: Date.now().toString(),
          role: 'system',
          content: `你拍了拍 "${character.remark}"`,
          timestamp: Date.now(),
          mode: viewMode === 'theater_room' ? 'theater' : 'online',
          scenarioId: activeScenarioId || undefined
      };
      if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) {
         onUpdateCharacter(prev => ({ ...prev, scenarios: prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: [...(s.messages || []), patMsg] } : s) }));
      } else {
         onAddMessage(character.id, patMsg);
      }
  };
  
  const handleGame = (type: 'DICE') => {
      const val = Math.floor(Math.random() * 6) + 1;
      handleSend(true, `[骰子] 掷出了 ${val} 点`);
  };

  // --- NEW PARSER FOR TAGS v2 (Split Text Bubbles) ---
  const parseAIResponseTags = (text: string, currentChar: Character): ParsedAIResponse => {
      const messages: Message[] = [];
      const retracts: { id: string, delay: number }[] = [];
      const moments: { content: string, images?: string[] }[] = [];
      let accumulatedOS = '';
      let transferAction: 'received' | 'refunded' | undefined = undefined;

      let cleanText = cleanMarkdown(text);
      
      // 1. GLOBAL CHECK FOR TRANSFER TAGS (Before removing INNER)
      if (/\[\s*ACCEPT_TRANSFER\s*\]/i.test(cleanText)) {
          transferAction = 'received';
      } else if (/\[\s*REFUSE_TRANSFER\s*\]/i.test(cleanText)) {
          transferAction = 'refunded';
      }

      // Remove the tags from text so they don't show up in bubbles
      cleanText = cleanText.replace(/\[\s*ACCEPT_TRANSFER\s*\]/i, '');
      cleanText = cleanText.replace(/\[\s*REFUSE_TRANSFER\s*\]/i, '');
      
      // 2. Extract and Remove INNER tags
      const innerRegex = /\[INNER:([\s\S]*?)\]/gi;
      let match;
      while ((match = innerRegex.exec(cleanText)) !== null) {
          accumulatedOS += (accumulatedOS ? '\n' : '') + match[1].trim();
      }
      cleanText = cleanText.replace(innerRegex, '');

      // 3. Split by Media Tags
      // We look for [TAG: ...]
      const tagRegex = /(\[(?:IMAGE|VOICE|TRANSFER|LOCATION|GOSSIP|RETRACT|VIDEO|PATS_YOU|MOMENT):[^\]]*\]|\[PATS_YOU\])/g;
      const parts = cleanText.split(tagRegex);
      
      parts.forEach((part, index) => {
          if (!part.trim()) return;

          const baseTimestamp = Date.now() + index * 100;

          if (part.startsWith('[') && part.endsWith(']')) {
              // --- HANDLE TAGS ---
              const msgBase: Message = {
                  id: baseTimestamp.toString(),
                  role: 'model',
                  content: '',
                  timestamp: baseTimestamp,
                  mode: 'online',
                  scenarioId: activeScenarioId || undefined,
                  msgType: 'text'
              };

              const tagContent = part.substring(1, part.length - 1); // remove [ ]
              const colonIndex = tagContent.indexOf(':');
              const type = colonIndex > -1 ? tagContent.substring(0, colonIndex).trim() : tagContent.trim();
              const val = colonIndex > -1 ? tagContent.substring(colonIndex + 1).trim() : '';
              const [p1, p2] = val.split('|').map(s => s.trim());

              switch (type) {
                  case 'IMAGE':
                      msgBase.msgType = 'image';
                      msgBase.content = p1 || '照片';
                      break;
                  case 'VOICE':
                      msgBase.msgType = 'voice';
                      msgBase.content = p1 || '[语音]';
                      msgBase.meta = { textContent: p1, duration: parseInt(p2) || 3 };
                      break;
                  case 'TRANSFER':
                      msgBase.msgType = 'transfer';
                      msgBase.meta = { amount: parseFloat(p1) || 0 };
                      msgBase.content = p2 || '转账给您';
                      break;
                  case 'LOCATION':
                      msgBase.msgType = 'location';
                      msgBase.content = p1 || '未知地点';
                      break;
                  case 'GOSSIP':
                      msgBase.msgType = 'gossip';
                      msgBase.meta = { title: p1, content: p2 };
                      msgBase.content = p1 || '八卦新闻';
                      break;
                  case 'RETRACT':
                      msgBase.content = p1 || '...';
                      msgBase.isRecalled = false;
                      retracts.push({ id: msgBase.id, delay: parseInt(p2) || 2000 });
                      break;
                  case 'VIDEO':
                      msgBase.msgType = 'video_call';
                      msgBase.content = p1 || '视频通话邀请';
                      break;
                  case 'PATS_YOU':
                      msgBase.role = 'system';
                      msgBase.content = `${currentChar.remark} 拍了拍我`;
                      msgBase.msgType = 'nudge';
                      break;
                  case 'MOMENT':
                      // Capture moment data but DO NOT push to message list
                      moments.push({ content: p1, images: p2 ? [p2] : undefined });
                      return; // SKIP pushing this as a message
                  default:
                      msgBase.content = part; // Fallback
                      break;
              }
              messages.push(msgBase);

          } else {
              // --- HANDLE TEXT (SPLIT BY NEWLINES) ---
              // This is the fix for "multiple bubbles"
              const lines = part.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              
              lines.forEach((line, lineIdx) => {
                  messages.push({
                      id: baseTimestamp.toString() + '_' + lineIdx,
                      role: 'model',
                      content: line,
                      timestamp: baseTimestamp + lineIdx * 10,
                      mode: 'online',
                      scenarioId: activeScenarioId || undefined,
                      msgType: 'text'
                  });
              });
          }
      });

      // Attach accumulated OS to the very first message
      if (messages.length > 0 && accumulatedOS) {
          messages[0].osContent = accumulatedOS;
      }

      return { messages, retracts, transferAction, moments };
  };

  const fetchAIReply = async (currentChar: Character) => {
    const isOffline = viewMode === 'offline';
    const isTheater = viewMode === 'theater_room';
    
    let currentScenario = null;
    if (isTheater && activeScenarioId) {
        currentScenario = currentChar.scenarios?.find(s => s.id === activeScenarioId);
    }

    const memoryInjection = currentChar.memories.map(m => `[长期记忆: ${m.content}]`).join('\n');
    const mainContext = currentChar.contextMemory ? `[主线重要上下文]: ${currentChar.contextMemory}` : '';
    const scenarioContext = (isTheater && currentScenario && !currentScenario.isConnected) ? `[剧场上下文]: ${currentScenario.contextMemory || ''}` : '';
    const personaInjection = currentUserDesc ? `\n[用户(${currentUserName})设定: ${currentUserDesc}]` : '';
    const timeInjection = currentChar.realTimeMode ? `\n[现实世界时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}]` : '';

    let fullSystemPrompt = '';
    if (isTheater && currentScenario) {
        fullSystemPrompt = `[THEATER MODE: ${currentScenario.title}]\n${currentScenario.systemPrompt}\n\n${personaInjection}`;
        if (currentScenario.isConnected) fullSystemPrompt += `\n\n[注意：本剧场与主线记忆互通]\n${memoryInjection}\n${mainContext}`;
        else fullSystemPrompt += `\n\n[注意：本剧场为独立平行宇宙]\n${scenarioContext}`;
    } else if (isOffline) {
        fullSystemPrompt = interpolatePrompt(currentChar.offlineConfig.systemPrompt, {
            ai_name: currentChar.name, 
            user_mask_name: currentUserName, 
            user_mask_description: currentUserDesc || '无详细描述',
            style: currentChar.offlineConfig.style, 
            word_count: currentChar.offlineConfig.wordCount.toString()
        });
        fullSystemPrompt += `\n\n${memoryInjection}\n${mainContext}`;
    } else {
        let promptTemplate = currentChar.systemPrompt;
        if (currentChar.showOS && currentChar.osSystemPrompt) promptTemplate += `\n\n${currentChar.osSystemPrompt}`;
        
        let basePrompt = interpolatePrompt(promptTemplate, { 
            ai_name: currentChar.name, 
            user_mask_name: currentUserName, 
            user_mask_description: currentUserDesc || '无详细描述',
            personality: currentChar.personality 
        });
        
        fullSystemPrompt = `${basePrompt}${timeInjection}\n\n${memoryInjection}\n${mainContext}`;
    }

    const historyCount = currentChar.historyCount || 20;
    let history: any[] = [];
    if (isTheater && currentScenario && !currentScenario.isConnected) history = (currentScenario.messages || []).slice(-historyCount);
    else {
        history = currentChar.messages.slice(-historyCount);
    }

    const processedHistory = history.filter(m => !m.isRecalled).map(m => {
        let finalContent = m.content;
        
        // --- PROCESSED HISTORY FIX: Handle Rich Media Content in History ---
        // If it is a real image (Base64), don't send the full string to AI to save tokens.
        if (m.msgType === 'image' && m.content.startsWith('data:image')) {
            finalContent = '[用户发送了一张图片]';
        } else if (m.msgType === 'transfer') {
            const statusStr = m.meta?.status ? `(状态:${m.meta.status})` : '';
            finalContent = `[转账: ${m.meta?.amount}元${statusStr}] ${m.content}`;
        } else if (m.msgType === 'location') {
            finalContent = `[位置: ${m.content}]`;
        } else if (m.msgType === 'voice') {
            finalContent = `[语音消息: ${m.meta?.textContent || '...'}]`;
        }

        if (m.quote) finalContent = `> 引用回复 "${m.quote.name}": ${m.quote.content}\n\n${finalContent}`;
        if (m.isRecalled) finalContent = "[该消息已撤回]"; 
        
        return {
            role: m.role,
            content: m.role === 'model' ? (m.osContent ? `[INNER:${m.osContent}] ${finalContent}` : finalContent) : finalContent
        };
    });

    // --- CHECK FOR PENDING TRANSFER & FORCE SYSTEM INJECTION ---
    // Ensure we are checking the latest message list
    const targetMsgs = (isTheater && currentScenario && !currentScenario.isConnected) ? currentScenario.messages : currentChar.messages;
    const pendingTransfer = [...(targetMsgs || [])]
        .reverse()
        .find(m => m.role === 'user' && m.msgType === 'transfer' && (!m.meta?.status || m.meta.status === 'pending'));

    let tailInjection = null;
    if (isOffline) {
        tailInjection = { role: 'system', content: `[SYSTEM FORCE: OFFLINE MODE ACTIVE]\nFORBIDDEN: JSON format.\nREQUIRED: Novel/Script format. One single coherent response block. Output plain text ONLY.` };
    } else if (isTheater) {
        tailInjection = { role: 'system', content: `[SYSTEM: THEATER MODE]\nRoleplay strictly. Output as one coherent block of text/script.` };
    } else {
        // Stronger Injection to prevent "Novel Style" leaking into Chat
        tailInjection = { role: 'system', content: `[SYSTEM FORCE: ONLINE/WECHAT MODE ACTIVE]\n当前场景：手机微信聊天界面。\n强制要求：\n1. 严禁描写任何动作、神态、环境（如“笑了笑”、“拿起手机”等）。\n2. 仅输出气泡对话内容。\n3. 使用短句，口语化。\n4. 忽略之前可能存在的线下/剧场模式的描写惯性，立刻回到网聊状态。\n5. 不要输出任何 *斜体* 或 (括号) 里的动作描写。\n6. 严禁使用 [IMAGE] 发表情包，请用 emoji 代替。` };
    }
    
    // Construct Messages
    const apiMessages = [ { role: 'system', content: fullSystemPrompt }, ...processedHistory ];
    
    if (tailInjection) apiMessages.push(tailInjection);

    // *** CRITICAL TRANSFER INJECTION ***
    if (pendingTransfer) {
        apiMessages.push({
            role: 'system',
            content: `[系统强制指令] 检测到用户刚才给你发了转账(金额: ${pendingTransfer.meta?.amount})。你必须在本次回复中决定：\n1. 包含 [ACCEPT_TRANSFER] 表示收款。\n2. 包含 [REFUSE_TRANSFER] 表示退回。\n不要忽略这个操作。`
        });
    }
    
    try {
        const rawResponse = await generateChatCompletion(apiMessages, settings);
        
        const messagesToAdd: Message[] = [];
        const messagesToRetract: { id: string, delay: number }[] = [];
        
        let cleanResponse = cleanMarkdown(rawResponse);
        
        if (isOffline || isTheater) {
            // --- OFFLINE/THEATER MODE: Single Block ---
            const { inner, clean } = extractInnerContent(cleanResponse);
            
            // Do NOT split by ||| or newlines. Keep it as one big block for immersion.
            if (clean.trim()) {
                messagesToAdd.push({
                    id: Date.now().toString(),
                    role: 'model',
                    content: clean.trim(),
                    osContent: inner,
                    timestamp: Date.now(),
                    mode: isOffline ? 'offline' : 'theater',
                    scenarioId: activeScenarioId || undefined
                });
            }

        } else {
            // --- ONLINE MODE: TAG PARSER V3 ---
            const result = parseAIResponseTags(cleanResponse, currentChar);
            messagesToAdd.push(...result.messages);
            messagesToRetract.push(...result.retracts);

            // Handle Moments
            if (result.moments && result.moments.length > 0 && onPostMoment) {
                // Post detected moments
                result.moments.forEach(m => {
                    onPostMoment(m.content, m.images);
                });
            }

            // Handle Transfer Action (AI accepted/refused user money)
            if (result.transferAction) {
                const action = result.transferAction;
                // Find the latest pending transfer from USER
                // We must use the message list from the PASSED currentChar which is the freshest state
                // Re-fetch targetMsgs here to be safe
                const latestTargetMsgs = (isTheater && currentScenario && !currentScenario.isConnected) ? currentScenario.messages : currentChar.messages;
                
                if (latestTargetMsgs) {
                    const foundPendingTransfer = [...latestTargetMsgs].reverse().find(m => m.role === 'user' && m.msgType === 'transfer' && (!m.meta?.status || m.meta.status === 'pending'));
                    
                    if (foundPendingTransfer) {
                        const updateTransferStatus = (msgs: Message[]) => msgs.map(m => {
                            if (m.id === foundPendingTransfer.id) {
                                // Create a fresh object to force re-render
                                return { ...m, meta: { ...m.meta, status: action } };
                            }
                            return m;
                        });

                        // Apply update immediately
                        if (isTheater && currentScenario && !currentScenario.isConnected) {
                            onUpdateCharacter(prev => ({ 
                                ...prev, 
                                scenarios: prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: updateTransferStatus(s.messages || []) } : s) 
                            }));
                        } else {
                            onUpdateCharacter(prev => ({ ...prev, messages: updateTransferStatus(prev.messages) }));
                        }
                    }
                }
            }

            if (messagesToAdd.length === 0) {
                 console.log("AI generated empty content, suppressing.");
            }
        }

        setIsTyping(false);

        for (let i = 0; i < messagesToAdd.length; i++) {
            await new Promise(resolve => setTimeout(resolve, i === 0 ? 300 : 800));
            const newMsg = messagesToAdd[i];

            if (isTheater && currentScenario && !currentScenario.isConnected) {
                onUpdateCharacter(prev => ({ 
                    ...prev, 
                    scenarios: prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: [...(s.messages || []), newMsg] } : s)
                }));
            } else {
                onAddMessage(currentChar.id, newMsg);
            }

            // Handle Retraction
            const retractInfo = messagesToRetract.find(r => r.id === newMsg.id);
            if (retractInfo) {
                setTimeout(() => {
                    const updateRetract = (msgs: Message[]) => msgs.map(m => { 
                        if (m.id === retractInfo.id) { 
                            return { 
                                ...m, 
                                isRecalled: true, 
                                originalContent: m.content, 
                                content: '对方撤回了一条消息', 
                                osContent: undefined 
                            }; 
                        } 
                        return m; 
                    });

                    if (isTheater && currentScenario && !currentScenario.isConnected) {
                        onUpdateCharacter(prev => ({ ...prev, scenarios: prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: updateRetract(s.messages || []) } : s) }));
                    } else {
                        onUpdateCharacter(prev => ({ ...prev, messages: updateRetract(prev.messages) }));
                    }
                }, retractInfo.delay);
            }
        }

    } catch (e: any) {
        console.error(e);
        if (onShowNotification) onShowNotification("❌ " + e.message);
        setIsTyping(false);
    }
    setGlobalGenerating(false);
  };

  const bindLongPress = (msgId: string) => ({ onContextMenu: (e: any) => { e.preventDefault(); setContextMenuMsgId(msgId); } });
  const handleDeleteMsg = () => { if (!contextMenuMsgId) return; if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) { onUpdateCharacter(prev => ({ ...prev, scenarios: prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: s.messages?.filter(m => m.id !== contextMenuMsgId) } : s) })); } else { onUpdateCharacter(prev => ({ ...prev, messages: prev.messages.filter(m => m.id !== contextMenuMsgId) })); } setContextMenuMsgId(null); };
  const handleRecallMsg = () => { if (!contextMenuMsgId) return; const updateLogic = (msgs: Message[]) => msgs.map(m => { if (m.id === contextMenuMsgId) { return { ...m, isRecalled: true, originalContent: m.content, content: '对方撤回了一条消息', osContent: undefined }; } return m; }); if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) { onUpdateCharacter(prev => ({ ...prev, scenarios: prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: updateLogic(s.messages || []) } : s) })); } else { onUpdateCharacter(prev => ({ ...prev, messages: updateLogic(prev.messages) })); } setContextMenuMsgId(null); };
  const handleRegenerate = () => { if (!contextMenuMsgId) return; let targetList: Message[] = []; let isIsolated = false; if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) { targetList = activeScenario.messages || []; isIsolated = true; } else { targetList = character.messages; } const targetIndex = targetList.findIndex(m => m.id === contextMenuMsgId); if (targetIndex === -1) return; let rewindIndex = targetIndex; while (rewindIndex >= 0 && targetList[rewindIndex].role === 'model') { rewindIndex--; } if (rewindIndex < 0) { setContextMenuMsgId(null); return; } const prevMessages = targetList.slice(0, rewindIndex + 1); let tempCharState = { ...character }; if (isIsolated) { onUpdateCharacter(prev => ({ ...prev, scenarios: prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: prevMessages } : s) })); tempCharState = { ...character, scenarios: character.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: prevMessages } : s) }; } else { onUpdateCharacter(prev => ({ ...prev, messages: prevMessages })); tempCharState = { ...character, messages: prevMessages }; } setContextMenuMsgId(null); setIsTyping(true); setGlobalGenerating(true); fetchAIReply(tempCharState).catch(e => { console.error(e); setIsTyping(false); setGlobalGenerating(false); }); };
  const startEdit = () => { let targetList = (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) ? activeScenario.messages : character.messages; const msg = targetList?.find(m => m.id === contextMenuMsgId); if (msg) { setEditContent(msg.content); setEditingMsgId(contextMenuMsgId); } setContextMenuMsgId(null); };
  const confirmEdit = () => { if (!editingMsgId) return; const updateLogic = (msgs: Message[]) => msgs.map(m => { if (m.id === editingMsgId) return { ...m, content: editContent }; return m; }); if (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) { onUpdateCharacter(prev => ({ ...prev, scenarios: prev.scenarios?.map(s => s.id === activeScenarioId ? { ...s, messages: updateLogic(s.messages || []) } : s) })); } else { onUpdateCharacter(prev => ({ ...prev, messages: updateLogic(prev.messages) })); } setEditingMsgId(null); };
  const handleQuoteMsg = () => { if (!contextMenuMsgId) return; const listToSearch = (viewMode === 'theater_room' && activeScenario && !activeScenario.isConnected) ? activeScenario.messages : character.messages; const msg = listToSearch?.find(m => m.id === contextMenuMsgId); if (msg && !msg.isRecalled) { setQuotingMsg(msg); if (inputRef.current) inputRef.current.focus(); } setContextMenuMsgId(null); };
  const saveCharSettings = () => { onUpdateCharacter(tempCharConfig); setShowCharSettings(false); setShowOfflineSettings(false); };
  
  // FIXED: Safer Offline Background Upload with Compression
  const handleOfflineBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { 
      const file = e.target.files?.[0]; 
      if (file) {
          try {
              const compressed = await compressImage(file);
              setTempCharConfig(prev => ({ ...prev, offlineConfig: { ...prev.offlineConfig, bgUrl: compressed } }));
          } catch (err) {
              console.error("Image processing failed", err);
              alert("图片处理失败，请重试");
          }
      }
  };

  const handleUserMaskAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { try { const compressed = await compressImage(file, 200); setTempCharConfig(prev => ({...prev, userMaskAvatar: compressed})); } catch(e){ alert("图片太大了"); } } };
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { try { const compressed = await compressImage(file, 300); setTempCharConfig(prev => ({...prev, avatar: compressed})); } catch(e){ alert("图片太大了"); } } };
  
  // FIXED: Safer Background Upload with Compression to prevent crash
  // Adjusted max width to 800 and quality to 0.6
  // Updated: Use the same helper and logic as offline mode to prevent OOM
  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => { 
      const file = e.target.files?.[0]; 
      if (file) { 
          try {
              // Resize to 600px max width, 0.5 quality to ensure it fits in localStorage and memory
              const compressed = await compressImage(file, 600, 0.5);
              setTempCharConfig(prev => ({...prev, chatBackground: compressed})); 
          } catch (err) {
              console.error("Bg upload failed", err);
              alert("壁纸设置失败，图片可能太大或格式不支持");
          }
      } 
  };
  
  const toggleMemorySelection = (id: string) => { onUpdateCharacter(prev => ({ ...prev, memories: prev.memories.map(m => m.id === id ? { ...m, selected: !m.selected } : m) })); };
  const handleFuse = async () => { if (!settings.apiKey) { alert("请配置 API Key"); return; } const selected = character.memories.filter(m => m.selected); if (selected.length < 2) return; setIsTyping(true); setGlobalGenerating(true); const contentToFuse = selected.map(m => m.content).join('\n---\n'); const prompt = `${FUSE_PROMPT}\n\n待合并记忆:\n${contentToFuse}`; try { const fusedContent = await generateChatCompletion([{ role: 'user', content: prompt }], settings); const newMemory: MemoryCard = { id: Date.now().toString(), timestamp: Date.now(), event: "融合记忆", content: fusedContent, location: "思维殿堂" }; onUpdateCharacter(prev => ({ ...prev, memories: [newMemory, ...prev.memories.filter(m => !m.selected)] })); } catch (e) { console.error(e); } setIsTyping(false); setGlobalGenerating(false); };
  const handleSummarize = async (scopeCount: number = 30, isAuto: boolean = false) => { if (!settings.apiKey) return; if (!isAuto) { setIsTyping(true); setGlobalGenerating(true); } const recentMsgs = character.messages.slice(-scopeCount).map(m => `[${m.mode === 'offline' ? '线下' : '线上'}] ${m.role}: ${m.content}`).join('\n'); const prompt = `${ARCHIVIST_PROMPT}\n\n聊天记录 (最近${scopeCount}条):\n${recentMsgs}`; try { const result = await generateChatCompletion([{ role: 'user', content: prompt }], settings); let jsonStr = result.trim(); if (jsonStr.startsWith('```json')) jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, ''); if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, ''); let parsed; try { parsed = JSON.parse(jsonStr); } catch { parsed = { summary: result, event: '总结' }; } const newMemory: MemoryCard = { id: Date.now().toString(), timestamp: Date.now(), location: parsed.location || '未知地点', event: parsed.event || (isAuto ? '自动总结' : '手动总结'), content: parsed.summary || result, status: parsed.status, }; onUpdateCharacter(prev => ({ ...prev, memories: [newMemory, ...prev.memories] })); } catch (e) { console.error("Summary failed", e); if (!isAuto) alert("总结失败: AI 返回格式错误。"); } if (!isAuto) { setIsTyping(false); setGlobalGenerating(false); } };
  const confirmClearHistory = (clearAll: boolean) => { let updatedChar = { ...tempCharConfig, messages: [] }; if (clearAll) { updatedChar.contextMemory = ''; updatedChar.memories = []; } setTempCharConfig(updatedChar); onUpdateCharacter(prev => ({ ...prev, ...updatedChar })); setShowClearHistoryModal(false); };
  const saveFurnaceConfig = () => { onUpdateCharacter(prev => ({...prev, furnaceConfig: tempCharConfig.furnaceConfig})); setShowMemoryFurnace(false); };

  const renderCommonModals = () => (
    <>
      {contextMenuMsgId && (
        <div className="absolute inset-0 z-50 bg-black/20 flex flex-col justify-end" onClick={() => setContextMenuMsgId(null)}>
            <div className="bg-white rounded-t-2xl p-4 animate-slide-up space-y-2 shadow-2xl pb-8" onClick={e => e.stopPropagation()}>
                <div className="text-center text-xs text-gray-400 mb-2">消息操作</div>
                <div className="grid grid-cols-4 gap-2 mb-2">
                    <button onClick={handleQuoteMsg} className="flex flex-col items-center gap-1 p-2 bg-gray-50 rounded active:bg-gray-100"><div className="w-10 h-10 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center"><i className="fas fa-quote-right"></i></div><span className="text-[10px]">引用</span></button>
                    <button onClick={startEdit} className="flex flex-col items-center gap-1 p-2 bg-gray-50 rounded active:bg-gray-100"><div className="w-10 h-10 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center"><i className="fas fa-pen"></i></div><span className="text-[10px]">编辑</span></button>
                    <button onClick={handleRecallMsg} className="flex flex-col items-center gap-1 p-2 bg-gray-50 rounded active:bg-gray-100"><div className="w-10 h-10 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center"><i className="fas fa-undo"></i></div><span className="text-[10px]">撤回</span></button>
                    <button onClick={handleRegenerate} className="flex flex-col items-center gap-1 p-2 bg-gray-50 rounded active:bg-gray-100"><div className="w-10 h-10 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center"><i className="fas fa-sync-alt"></i></div><span className="text-[10px]">重写</span></button>
                </div>
                <button onClick={handleDeleteMsg} className="w-full py-3 bg-red-50 text-red-900 rounded-xl font-bold flex items-center justify-center gap-2"><i className="fas fa-trash"></i> 删除此消息</button>
                <button onClick={() => setContextMenuMsgId(null)} className="w-full py-3 bg-white border border-gray-200 text-gray-500 rounded-xl font-bold">取消</button>
            </div>
        </div>
      )}
      {showClearHistoryModal && (<div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6"><div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl animate-fade-in"><h3 className="text-gray-900 font-bold text-lg mb-4">清空确认</h3><div className="flex flex-col gap-2"><button onClick={() => confirmClearHistory(false)} className="w-full py-3 bg-red-50 text-red-900 font-bold rounded-lg hover:bg-red-100">仅清空聊天记录</button><button onClick={() => confirmClearHistory(true)} className="w-full py-3 bg-red-900 text-white font-bold rounded-lg">完全重置</button><button onClick={() => setShowClearHistoryModal(false)} className="w-full py-3 text-gray-500 font-bold">取消</button></div></div></div>)}
      
      {/* Transfer Action Modal - RESTRICTED TO MODEL MESSAGES */}
      {transferActionMsg && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => setTransferActionMsg(null)}>
              <div className="bg-white w-full max-w-xs rounded-xl p-6 shadow-2xl animate-slide-up relative text-center" onClick={e => e.stopPropagation()}>
                  <div className="w-14 h-14 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"><i className="fas fa-yen-sign"></i></div>
                  <h3 className="text-gray-900 font-bold text-lg mb-1">交易操作</h3>
                  <p className="text-gray-500 text-xs mb-6">¥{Number(transferActionMsg.meta?.amount).toFixed(2)} - {transferActionMsg.content}</p>
                  <div className="flex flex-col gap-3">
                      <button onClick={() => handleTransferStatusUpdate('received')} className="w-full py-3 bg-[#07c160] text-white rounded-xl font-bold hover:opacity-90">确认收款</button>
                      <button onClick={() => handleTransferStatusUpdate('refunded')} className="w-full py-3 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100">立即退款</button>
                  </div>
              </div>
          </div>
      )}
      
      {/* Inner Monologue Modal with Dark Mode Toggle */}
      {activeInnerContent && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-8 animate-fade-in" onClick={() => setActiveInnerContent(null)}>
            <div 
                className={`w-full max-w-sm rounded-lg p-6 shadow-2xl relative animate-slide-up flex flex-col items-center text-center transition-colors duration-300 ${innerDarkMode ? 'bg-stone-900 text-stone-200' : 'bg-white text-gray-800'}`} 
                onClick={e => e.stopPropagation()}
            >
                {/* Toggle Button */}
                <button 
                    onClick={() => setInnerDarkMode(!innerDarkMode)}
                    className={`absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${innerDarkMode ? 'bg-stone-800 text-amber-500 hover:bg-stone-700' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                >
                    <i className={`fas ${innerDarkMode ? 'fa-sun' : 'fa-moon'}`}></i>
                </button>

                <div className="text-red-900 text-2xl mb-4"><i className="fas fa-heart"></i></div>
                <div className="font-serif text-[15px] leading-loose whitespace-pre-wrap">
                    {activeInnerContent}
                </div>
                <div className={`mt-6 pt-4 border-t w-full ${innerDarkMode ? 'border-stone-800' : 'border-gray-100'}`}>
                    <button onClick={() => setActiveInnerContent(null)} className={`text-xs font-sans tracking-widest ${innerDarkMode ? 'text-stone-500' : 'text-gray-400'}`}>关闭心声</button>
                </div>
            </div>
        </div>
      )}

      {/* Photo Description Modal */}
      {photoDescription && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-8 animate-fade-in" onClick={() => setPhotoDescription(null)}>
            <div className="bg-white w-full max-w-sm rounded-lg p-6 shadow-2xl relative animate-slide-up flex flex-col items-center text-center" onClick={e => e.stopPropagation()}>
                <div className="text-gray-400 text-3xl mb-4"><i className="fas fa-image"></i></div>
                <div className="font-serif text-[15px] leading-loose text-gray-800 whitespace-pre-wrap italic">
                    “{photoDescription}”
                </div>
                <div className="mt-6 pt-4 border-t w-full border-gray-100">
                    <button onClick={() => setPhotoDescription(null)} className="text-xs text-gray-400 font-sans tracking-widest">关闭照片</button>
                </div>
            </div>
        </div>
      )}

      {/* Real Image Viewer Modal */}
      {viewingImage && (
        <div className="absolute inset-0 z-50 bg-black flex items-center justify-center animate-fade-in" onClick={() => setViewingImage(null)}>
            <img src={viewingImage} className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()}/>
            <button className="absolute top-4 right-4 text-white text-2xl drop-shadow-md"><i className="fas fa-times"></i></button>
        </div>
      )}

      {showOSModal && (<div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6"><div className="bg-white w-full max-w-sm rounded-xl p-6 shadow-2xl relative animate-slide-up"><button onClick={() => setShowOSModal(false)} className="absolute top-2 right-2 text-gray-400 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"><i className="fas fa-times"></i></button><h3 className="font-bold text-stone-800 mb-4 flex items-center gap-2">内心独白 (OS)</h3><div className="bg-stone-50 p-3 rounded-lg mb-4 flex items-center justify-between"><div><div className="font-bold text-stone-900 text-sm">OS 开关</div></div><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" className="sr-only peer" checked={character.showOS || false} onChange={(e) => onUpdateCharacter(prev => ({...prev, showOS: e.target.checked}))}/><div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-stone-800"></div></label></div><textarea className="w-full h-32 p-2 border border-gray-200 rounded text-xs bg-gray-50 focus:outline-none focus:border-stone-500 font-mono text-gray-600" value={character.osSystemPrompt || DEFAULT_OS_PROMPT} onChange={(e) => onUpdateCharacter(prev => ({...prev, osSystemPrompt: e.target.value}))}/></div></div>)}
      {editingMsgId && (<div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-4"><div className="bg-white w-full max-w-sm rounded-xl p-4 shadow-2xl animate-slide-up"><h3 className="font-bold mb-2 text-gray-700">编辑消息</h3><textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="w-full h-32 border p-2 rounded mb-4 focus:outline-none focus:border-stone-500 resize-none bg-gray-50"/><div className="flex gap-3"><button onClick={() => setEditingMsgId(null)} className="flex-1 py-2 bg-gray-100 text-gray-600 rounded font-bold">取消</button><button onClick={confirmEdit} className="flex-1 py-2 bg-stone-900 text-white rounded font-bold">保存</button></div></div></div>)}
      
      {/* --- User Tools Modals --- */}
      {activeToolModal === 'LOCATION' && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => setActiveToolModal(null)}>
              <div className="bg-white w-full max-w-xs rounded-xl p-6 shadow-2xl animate-slide-up relative" onClick={e => e.stopPropagation()}>
                  <h3 className="text-gray-900 font-bold mb-4 flex items-center gap-2"><i className="fas fa-map-marker-alt text-red-500"></i> 发送位置</h3>
                  <input autoFocus value={toolData.location} onChange={e => setToolData({...toolData, location: e.target.value})} placeholder="输入地点名称..." className="w-full p-2 bg-gray-100 rounded border border-gray-200 mb-4 focus:outline-none focus:border-red-500"/>
                  <button onClick={handleToolSend} className="w-full py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700">发送</button>
              </div>
          </div>
      )}
      {activeToolModal === 'TRANSFER' && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => setActiveToolModal(null)}>
              <div className="bg-white w-full max-w-xs rounded-xl p-6 shadow-2xl animate-slide-up relative" onClick={e => e.stopPropagation()}>
                  <h3 className="text-gray-900 font-bold mb-4 flex items-center gap-2"><i className="fas fa-yen-sign text-orange-500"></i> 发起转账</h3>
                  <div className="mb-2"><label className="text-xs text-gray-500 font-bold">金额</label><input type="number" value={toolData.transferAmount} onChange={e => setToolData({...toolData, transferAmount: e.target.value})} placeholder="0.00" className="w-full p-2 bg-gray-100 rounded border border-gray-200 focus:outline-none focus:border-orange-500"/></div>
                  <div className="mb-4"><label className="text-xs text-gray-500 font-bold">转账备注</label><input value={toolData.transferNote} onChange={e => setToolData({...toolData, transferNote: e.target.value})} placeholder="大吉大利" className="w-full p-2 bg-gray-100 rounded border border-gray-200 focus:outline-none focus:border-orange-500"/></div>
                  <button onClick={handleToolSend} className="w-full py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700">确认转账</button>
              </div>
          </div>
      )}
      {activeToolModal === 'VOICE' && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => setActiveToolModal(null)}>
              <div className="bg-white w-full max-w-xs rounded-xl p-6 shadow-2xl animate-slide-up relative" onClick={e => e.stopPropagation()}>
                  <h3 className="text-gray-900 font-bold mb-4 flex items-center gap-2"><i className="fas fa-microphone text-green-500"></i> 模拟语音消息</h3>
                  <textarea autoFocus value={toolData.voiceText} onChange={e => setToolData({...toolData, voiceText: e.target.value})} placeholder="输入语音内容，将自动计算时长..." className="w-full p-2 h-24 bg-gray-100 rounded border border-gray-200 mb-4 focus:outline-none focus:border-green-500 resize-none"/>
                  <div className="text-xs text-gray-400 mb-4 text-right">预计时长: {Math.max(1, Math.ceil(toolData.voiceText.length / 3))} 秒</div>
                  <button onClick={handleToolSend} className="w-full py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700">发送语音</button>
              </div>
          </div>
      )}
      {activeToolModal === 'PHOTO' && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => setActiveToolModal(null)}>
              <div className="bg-white w-full max-w-xs rounded-xl p-6 shadow-2xl animate-slide-up relative" onClick={e => e.stopPropagation()}>
                  <h3 className="text-gray-900 font-bold mb-4 flex items-center gap-2"><i className="fas fa-image text-blue-500"></i> 发送图片</h3>
                  <div className="flex mb-4 bg-gray-100 p-1 rounded-lg">
                      <button onClick={() => setToolData({...toolData, photoType: 'UPLOAD'})} className={`flex-1 py-1 rounded text-xs font-bold transition ${toolData.photoType === 'UPLOAD' ? 'bg-white shadow text-black' : 'text-gray-500'}`}>本地相册</button>
                      <button onClick={() => setToolData({...toolData, photoType: 'DESC'})} className={`flex-1 py-1 rounded text-xs font-bold transition ${toolData.photoType === 'DESC' ? 'bg-white shadow text-black' : 'text-gray-500'}`}>照片意象</button>
                  </div>
                  {toolData.photoType === 'UPLOAD' ? (
                      <div className="border-2 border-dashed border-gray-300 rounded-lg h-32 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 relative cursor-pointer">
                          <i className="fas fa-cloud-upload-alt text-2xl text-gray-400 mb-2"></i>
                          <span className="text-xs text-gray-500">点击上传本地图片</span>
                          <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleUserPhotoUpload} />
                      </div>
                  ) : (
                      <div className="space-y-2">
                          <textarea autoFocus value={toolData.photoDesc} onChange={e => setToolData({...toolData, photoDesc: e.target.value})} placeholder="例如: 一只在阳光下睡觉的猫..." className="w-full p-2 h-24 bg-gray-100 rounded border border-gray-200 focus:outline-none focus:border-blue-500 resize-none"/>
                          <button onClick={handleToolSend} className="w-full py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700">发送意象</button>
                      </div>
                  )}
              </div>
          </div>
      )}

      {showMemoryFurnace && (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
            <div className="bg-[#f2f2f2] w-full h-[90%] sm:h-[650px] sm:rounded-2xl rounded-t-2xl flex flex-col shadow-2xl animate-slide-up">
                <div className="p-4 border-b flex justify-between items-center bg-white rounded-t-2xl sticky top-0 z-10">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2"><span className="w-8 h-8 rounded bg-stone-100 text-stone-600 flex items-center justify-center"><i className="fas fa-brain"></i></span>记忆熔炉</h3>
                    <button onClick={() => setShowMemoryFurnace(false)} className="bg-gray-200 w-8 h-8 rounded-full text-gray-600"><i className="fas fa-times"></i></button>
                </div>
                <div className="bg-stone-50 p-4 border-b border-stone-100">
                    <div className="flex items-center justify-between mb-2"><span className="text-sm font-bold text-stone-900"><i className="fas fa-robot mr-1"></i> 自动总结设置</span><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" className="sr-only peer" checked={tempCharConfig.furnaceConfig?.autoEnabled} onChange={(e) => { const newConfig = { ...tempCharConfig.furnaceConfig, autoEnabled: e.target.checked }; setTempCharConfig({...tempCharConfig, furnaceConfig: newConfig}); }}/><div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-stone-800"></div></label></div>
                    {tempCharConfig.furnaceConfig?.autoEnabled && (<div className="grid grid-cols-2 gap-4 text-xs"><div className="flex flex-col gap-1"><label className="text-stone-800">触发频率 (条消息)</label><input type="number" className="p-1 rounded border border-stone-200" value={tempCharConfig.furnaceConfig.autoThreshold} onChange={(e) => { const val = parseInt(e.target.value) || 10; const newConfig = {...tempCharConfig.furnaceConfig, autoThreshold: val}; setTempCharConfig({...tempCharConfig, furnaceConfig: newConfig}); }}/></div><div className="flex flex-col gap-1"><label className="text-stone-800">总结范围 (最近X条)</label><input type="number" className="p-1 rounded border border-stone-200" value={tempCharConfig.furnaceConfig.autoScope} onChange={(e) => { const val = parseInt(e.target.value) || 20; const newConfig = {...tempCharConfig.furnaceConfig, autoScope: val}; setTempCharConfig({...tempCharConfig, furnaceConfig: newConfig}); }}/></div></div>)}
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {character.memories.length === 0 && <div className="flex flex-col items-center justify-center mt-10 text-gray-400 gap-2"><i className="fas fa-box-open text-4xl opacity-30"></i><span className="text-sm">暂无长期记忆档案</span></div>}
                    {character.memories.map(mem => (<div key={mem.id} className={`bg-white p-4 rounded-xl shadow-sm relative transition-all border ${mem.selected ? 'border-stone-500 ring-2 ring-stone-100' : 'border-gray-200'}`}><div onClick={() => toggleMemorySelection(mem.id)} className="cursor-pointer"><div className="flex justify-between items-start mb-2"><div className="flex gap-2 items-center"><span className="bg-stone-100 text-stone-700 text-[10px] px-2 py-0.5 rounded font-bold">{mem.location || '记忆'}</span><span className="text-xs text-gray-400">{new Date(mem.timestamp).toLocaleDateString()}</span></div><input type="checkbox" checked={!!mem.selected} onChange={() => toggleMemorySelection(mem.id)} className="w-5 h-5 accent-stone-600 pointer-events-none"/></div>{mem.event && <div className="font-bold text-gray-900 mb-2">{mem.event}</div>}<div className="text-sm text-gray-600 leading-relaxed text-justify">{mem.content}</div></div></div>))}
                </div>
                <div className="p-4 bg-white border-t flex flex-col gap-3 pb-8 sm:pb-4 rounded-b-2xl">
                    <div className="flex gap-2 items-center text-xs text-gray-500 mb-1"><span>手动总结范围: 最近</span><input type="number" className="w-12 border rounded text-center bg-gray-50 p-1" value={tempCharConfig.furnaceConfig?.manualScope || 30} onChange={(e) => { const val = parseInt(e.target.value) || 30; const newConfig = {...tempCharConfig.furnaceConfig, manualScope: val}; setTempCharConfig({...tempCharConfig, furnaceConfig: newConfig}); }}/><span>条消息</span></div>
                    <div className="flex gap-3"><button onClick={() => handleSummarize(tempCharConfig.furnaceConfig?.manualScope || 30, false)} disabled={isTyping} className="flex-1 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition shadow-sm">{isTyping ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-compress-alt"></i>} 立即总结</button><button onClick={handleFuse} disabled={character.memories.filter(m => m.selected).length < 2 || isTyping} className="flex-1 bg-gradient-to-r from-stone-700 to-stone-900 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg hover:shadow-stone-500/30 transition"><i className="fas fa-fire-alt"></i> 熔炼选中</button></div>
                    <button onClick={saveFurnaceConfig} className="w-full py-3 bg-stone-900 text-white rounded-xl font-bold shadow-lg hover:bg-black transition">💾 保存熔炉配置</button>
                </div>
            </div>
        </div>
      )}
    </>
  );

  // --- AUTO SUMMARIZE TRIGGER EFFECT ---
  useEffect(() => {
      if (character.furnaceConfig?.autoEnabled && !isGlobalGenerating) {
          const msgs = character.messages;
          const count = msgs.length;
          const threshold = character.furnaceConfig.autoThreshold || 20;
          if (count > 0 && count % threshold === 0) {
              console.log("Auto-Summarizing Triggered at message count:", count);
              handleSummarize(character.furnaceConfig.autoScope, true);
          }
      }
  }, [character.messages.length]);

  const renderImmersiveList = (messages: Message[], bgColor?: string) => {
      // Lazy Load Logic for Immersive
      const visibleMsgs = messages.slice(-visibleLimit);
      const hasMore = messages.length > visibleLimit;

      return (
          <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar relative z-10">
            {hasMore && (
                <div className="flex justify-center py-4 animate-fade-in">
                    <button onClick={() => setVisibleLimit(prev => prev + 50)} className="text-xs bg-stone-800 text-stone-400 border border-stone-600 px-4 py-2 rounded-full hover:bg-stone-700 transition">
                        <i className="fas fa-history mr-2"></i>加载更多剧情
                    </button>
                </div>
            )}
            
            {visibleMsgs.filter(m => !m.isHidden).map((msg) => (
               <div key={msg.id} {...bindLongPress(msg.id)} className={`animate-fade-in ${msg.role === 'user' ? 'pl-8 border-l-2 border-stone-600' : ''}`}>
                    <div className="text-xs text-stone-500 mb-1 font-sans uppercase tracking-wider flex justify-between">
                        <span>{msg.role === 'user' ? (character.useLocalPersona ? character.userMaskName : settings.globalPersona.name) : character.name}</span>
                        {msg.isRecalled && <span className="text-stone-600 italic">已撤回</span>}
                    </div>
                    {msg.quote && !msg.isRecalled && ( <div className="mb-2 pl-2 border-l-2 border-amber-600 bg-stone-800/50 p-1 text-xs text-stone-400 font-sans rounded"><span className="font-bold">{msg.quote.name}:</span> {msg.quote.content}</div> )}
                    {msg.isRecalled ? (
                        <div className="text-stone-600 italic cursor-pointer text-sm" onClick={() => alert(`原内容:\n${msg.originalContent || '无内容'}`)}>(对方撤回了动作 - 点击偷看)</div>
                    ) : (
                        <div 
                            className={`leading-loose whitespace-pre-wrap ${msg.role === 'user' ? 'text-stone-300 italic' : 'text-amber-100/90'}`} 
                            style={{ 
                                fontSize: `${settings.immersiveFontSize || 18}px`,
                                ...(msg.role === 'user' ? parseStyleString(character.styleConfig?.offlineUser || DEFAULT_STYLE_CONFIG.offlineUser) : parseStyleString(character.styleConfig?.offlineModel || DEFAULT_STYLE_CONFIG.offlineModel))
                            }}
                        >
                            {msg.content}
                        </div>
                    )}
               </div>
           ))}
           {isTyping && <div className="mt-4 animate-slide-up"><LoadingBubbles color={bgColor} /></div>}
           {/* Anchor div for auto-scrolling */}
           <div ref={messagesEndRef} />
        </div>
      );
  };

  // Simplified filter logic to satisfy TS
  // Filter for Online Messages
  const allOnlineMessages = useMemo(() => character.messages.filter(m => !m.isHidden && (!m.mode || m.mode === 'online')), [character.messages]);
  
  // --- RENDER HELPERS FOR SPECIAL MESSAGES ---
  
  const renderRichMessage = (msg: Message) => {
      // 1. Voice Message
      if (msg.msgType === 'voice') {
          return (
              <div 
                className="flex items-center gap-2 min-w-[100px] cursor-pointer active:opacity-70 transition" 
                onClick={(e) => {
                    const el = e.currentTarget;
                    el.classList.add('animate-pulse');
                    setTimeout(() => {
                        el.classList.remove('animate-pulse');
                        if(msg.meta?.textContent) alert(`[语音转文字]:\n${msg.meta.textContent}`);
                    }, 1000);
                }}
              >
                  <i className="fas fa-rss rotate-45 text-lg"></i>
                  <span className="font-bold">{msg.meta?.duration || 3}"</span>
                  <div className="w-1 h-1 bg-red-500 rounded-full ml-auto"></div>
              </div>
          );
      }
      
      // 2. Transfer (Red Packet)
      if (msg.msgType === 'transfer') {
          const status = msg.meta?.status || 'pending';
          // Styling Logic
          let bgColor = 'bg-[#fa9d3b]';
          let textColor = 'text-white';
          let icon = 'fa-yen-sign';
          let iconBg = 'border-2 border-white/30';
          let subText = '微信转账';
          let statusElement = null;

          if (status === 'received') {
              bgColor = 'bg-[#f7e8d5]'; // Lighter gray/beige for received
              textColor = 'text-gray-400';
              icon = 'fa-check';
              iconBg = 'border-none';
              subText = '已收款';
          } else if (status === 'refunded') {
              bgColor = 'bg-[#ea5f5f]'; // Red for refunded
              textColor = 'text-white';
              icon = 'fa-undo';
              subText = '已退还';
              statusElement = <span className="absolute top-2 right-2 text-[10px] bg-white/20 px-2 py-0.5 rounded font-bold">已退还</span>;
          }

          return (
              <div 
                onClick={() => msg.role === 'model' && setTransferActionMsg(msg)} 
                className={`${bgColor} p-0 rounded-[18px] w-60 overflow-hidden flex flex-col shadow-sm cursor-pointer active:brightness-95 transition relative`}
                style={{ cursor: msg.role === 'user' ? 'default' : 'pointer' }}
              >
                  {statusElement}
                  <div className={`p-4 flex items-center gap-4 ${textColor}`}>
                      <div className={`w-10 h-10 ${iconBg} rounded-full flex items-center justify-center`}>
                          <i className={`fas ${icon} text-xl`}></i>
                      </div>
                      <div className="flex flex-col">
                          {status === 'received' ? (
                               <span className="font-bold text-base">已收款</span>
                          ) : (
                               <>
                                <span className="font-bold text-base">¥{Number(msg.meta?.amount).toFixed(2)}</span>
                                <span className="text-xs opacity-90">{msg.content}{status === 'pending' && <span className="ml-1 opacity-70 text-[10px]">(等待确认)</span>}</span>
                               </>
                          )}
                      </div>
                  </div>
                  <div className="bg-black/5 p-1 px-3 text-[10px] text-black/40">
                      {subText}
                  </div>
                  {/* Overlay for received state to make it look disabled */}
                  {status === 'received' && <div className="absolute inset-0 bg-white/40 pointer-events-none"></div>}
              </div>
          );
      }

      // 3. Location
      if (msg.msgType === 'location') {
          return (
              <div className="w-60 bg-white rounded-[18px] overflow-hidden flex flex-col border border-gray-200 shadow-sm cursor-pointer">
                  <div className="p-2 text-sm font-bold truncate text-gray-800">{msg.content}</div>
                  <div className="text-[10px] text-gray-400 px-2 pb-1 truncate">北京市 海淀区</div>
                  <div className="h-28 bg-gray-200 relative">
                       <img src="https://picsum.photos/400/200?grayscale&blur=2" className="w-full h-full object-cover opacity-60" />
                       <div className="absolute inset-0 flex items-center justify-center text-red-500 text-3xl pb-2 drop-shadow-md"><i className="fas fa-map-marker-alt"></i></div>
                  </div>
              </div>
          );
      }

      // 4. Image Placeholder (New Design)
      if (msg.msgType === 'image') {
          // If content is Base64, render actual image
          if (msg.content.startsWith('data:image')) {
              return (
                  <div onClick={() => setViewingImage(msg.content)} className="cursor-pointer">
                      <img src={msg.content} className="max-w-[200px] max-h-[300px] rounded-lg border border-gray-200" />
                  </div>
              );
          }
          // Otherwise render placeholder
          return (
              <div 
                onClick={() => setPhotoDescription(msg.content)}
                className="w-24 h-24 bg-white border border-gray-200 rounded-[18px] flex items-center justify-center cursor-pointer shadow-sm hover:bg-gray-50 transition active:scale-95"
              >
                  <span className="text-xs text-gray-400 font-serif tracking-widest">照片</span>
              </div>
          );
      }

      // 5. Video Call Invite
      if (msg.msgType === 'video_call') {
          return (
              <div className="flex items-center gap-3 min-w-[180px] py-1 cursor-pointer">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-400 to-red-400 text-white flex items-center justify-center shadow-sm"><i className="fas fa-video"></i></div>
                  <div className="flex flex-col">
                      <span className="font-bold text-sm">{msg.content}</span>
                      <span className="text-[10px] opacity-70">点击接听</span>
                  </div>
              </div>
          );
      }

      // 6. Gossip / Article
      if (msg.msgType === 'gossip') {
          return (
              <div className="w-64 bg-white rounded-[18px] overflow-hidden border border-gray-200 flex flex-col shadow-sm cursor-pointer">
                  <div className="p-3 pb-1">
                     <div className="font-bold text-sm line-clamp-2 mb-1 text-gray-800">{msg.meta?.title || msg.content}</div>
                  </div>
                  <div className="h-32 bg-gray-100 relative mx-3 mb-2 rounded-lg overflow-hidden">
                      <img src={msg.meta?.imageUrl || 'https://picsum.photos/400/200'} className="w-full h-full object-cover" />
                  </div>
                  <div className="px-3 pb-3">
                      <div className="text-[10px] text-gray-400 line-clamp-2">{msg.meta?.content}</div>
                  </div>
                  <div className="border-t p-1 px-3 text-[10px] text-gray-400 flex justify-between items-center bg-gray-50">
                      <span>微信公众号</span>
                      <i className="fas fa-chevron-right"></i>
                  </div>
              </div>
          );
      }

      // Default Text
      return <span className="relative z-10 whitespace-pre-wrap break-words leading-relaxed">{formatLegacyMessage(msg.content)}</span>;
  };

  const renderChatList = () => {
    // Lazy Load Slice
    const messagesToRender = allOnlineMessages.slice(-visibleLimit);
    const hasMore = allOnlineMessages.length > visibleLimit;

    // Safely handle chat background style to prevent crashes
    const chatBgStyle = character.chatBackground
        ? { backgroundImage: `url(${character.chatBackground})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }
        : { backgroundColor: '#ededed' };

    return (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
            {hasMore && (
                <div className="flex justify-center py-2 animate-fade-in">
                    <button 
                        onClick={() => setVisibleLimit(prev => prev + 50)} 
                        className="text-xs text-blue-500 bg-blue-50 px-4 py-1.5 rounded-full hover:bg-blue-100 transition shadow-sm"
                    >
                        加载更多历史消息
                    </button>
                </div>
            )}
            
            {messagesToRender.map((msg, idx) => (
                <div key={msg.id} {...bindLongPress(msg.id)} className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in group`}>
                    {msg.role === 'model' && ( <img src={character.avatar} alt="avatar" onDoubleClick={handlePat} className="w-9 h-9 rounded-full bg-gray-300 mr-2 mt-auto object-cover cursor-pointer shadow-sm active:scale-95 transition" /> )}
                    
                    {/* System Messages (Nudge, Time, etc) */}
                    {msg.role === 'system' && ( <div className="w-full flex justify-center my-2"><span className="bg-gray-200/50 text-gray-500 text-xs px-2 py-1 rounded">{msg.content}</span></div> )}
                    
                    {/* Normal Messages */}
                    {msg.role !== 'system' && (
                        <div className={`max-w-[75%] flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} ${msg.quote ? 'min-w-[40%]' : 'w-fit'}`}>
                            {msg.isRecalled ? (
                                <div className="bg-gray-200 text-gray-500 text-xs px-2 py-1 rounded cursor-pointer select-none" onClick={() => alert(`原内容：\n${msg.originalContent || '未知内容'}`)}>{msg.content} <span className="text-[8px] opacity-0 group-hover:opacity-100 transition">(点击偷看)</span></div>
                            ) : (
                                // Determine Bubble Style based on content type
                                <div className="relative group/bubble">
                                    <div 
                                        className={`
                                            shadow-sm relative text-left max-w-full flex flex-col w-fit 
                                            ${msg.mode === 'offline' ? 'opacity-80 border border-purple-200' : ''}
                                            ${['transfer', 'location', 'gossip', 'image'].includes(msg.msgType || '') ? 'p-0 bg-transparent shadow-none' : 'px-4 py-2.5'}
                                        `}
                                        style={
                                            // Override styles for non-text bubbles to avoid green background
                                            ['transfer', 'location', 'gossip', 'image'].includes(msg.msgType || '') 
                                            ? {} 
                                            : (msg.role === 'user' 
                                                ? { ...parseStyleString(character.styleConfig?.onlineUser || DEFAULT_STYLE_CONFIG.onlineUser), fontSize: `${character.chatFontSize || 15}px`, borderRadius: '20px 4px 20px 20px' }
                                                : { ...parseStyleString(character.styleConfig?.onlineModel || DEFAULT_STYLE_CONFIG.onlineModel), fontSize: `${character.chatFontSize || 15}px`, borderRadius: '4px 20px 20px 20px' })
                                        }
                                    >
                                        {msg.quote && ( <div className={`mb-1 p-1 rounded text-xs border-l-2 mb-2 w-full ${msg.role === 'user' ? 'bg-[#89d961] border-[#6dbf44] text-emerald-900' : 'bg-gray-100 border-gray-300 text-gray-500'}`}><span className="font-bold mr-1">{msg.quote.name}:</span><span className="line-clamp-2">{msg.quote.content}</span></div> )}
                                        
                                        {/* Removed simple CSS arrow to use rounded corners instead for cleaner look */}
                                        
                                        {renderRichMessage(msg)}
                                    </div>
                                    
                                    {/* Inner Monologue Heart Button - Positioned to the right of AI bubbles */}
                                    {character.showOS && msg.osContent && !msg.isRecalled && msg.role === 'model' && (
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); setActiveInnerContent(msg.osContent || ''); }}
                                            className="absolute -right-6 bottom-0 text-gray-300 hover:text-red-900 hover:scale-110 transition-all cursor-pointer w-5 h-5 flex items-center justify-center animate-fade-in z-10"
                                            title="点击偷听心声"
                                        >
                                            <i className="fas fa-heart text-xs"></i>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {msg.role === 'user' && ( <img src={currentUserAvatar} className="w-9 h-9 rounded-full bg-gray-300 ml-2 mt-auto object-cover shadow-sm" /> )}
                </div>
            ))}
            <div ref={messagesEndRef} />
        </div>
    );
  };

  // --- 1. THEATER LIST VIEW ---
  if (viewMode === 'theater_list') {
      return (
          <div className="flex flex-col h-full bg-stone-900 text-white relative animate-fade-in font-serif">
              <div className="p-4 flex items-center justify-between bg-stone-800 border-b border-stone-700">
                  <button onClick={() => setViewMode('chat')} className="text-stone-400 hover:text-white"><i className="fas fa-arrow-left"></i> 返回微信</button>
                  <h2 className="text-xl font-bold text-stone-200">剧场模式</h2>
                  <button onClick={() => setIsCreatingScenario(true)} className="text-stone-400 hover:text-white"><i className="fas fa-plus"></i></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {(character.scenarios || []).map(scenario => (
                      <div key={scenario.id} className="bg-stone-800 rounded-xl overflow-hidden shadow-lg border border-stone-700 relative group">
                          <div className="h-24 bg-gradient-to-r from-stone-900 to-black p-4 flex flex-col justify-end relative">
                              {scenario.wallpaper && <img src={scenario.wallpaper} className="absolute inset-0 w-full h-full object-cover opacity-50" />}
                              <div className="relative z-10">
                                  <h3 className="font-bold text-lg">{scenario.title}</h3>
                                  <p className="text-xs text-stone-300 line-clamp-1">{scenario.description || '无简介'}</p>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleDeleteScenario(scenario.id); }} className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center bg-black/30 rounded-full text-stone-400 hover:text-red-500 z-20"><i className="fas fa-trash"></i></button>
                          </div>
                          <div className="p-4 flex justify-between items-center">
                              <span className={`text-xs px-2 py-1 rounded border ${scenario.isConnected ? 'border-stone-600 text-stone-400 bg-stone-900' : 'border-stone-600 text-stone-400 bg-stone-900'}`}>{scenario.isConnected ? '🔗 关联记忆' : '🌌 独立宇宙'}</span>
                              <button onClick={() => { setActiveScenarioId(scenario.id); setViewMode('theater_room'); }} className="px-4 py-2 bg-stone-700 text-white rounded font-bold text-sm hover:bg-stone-600">进入剧场</button>
                          </div>
                      </div>
                  ))}
                  {(character.scenarios || []).length === 0 && <div className="text-center text-stone-600 mt-10">暂无剧场，点击右上角创建。</div>}
              </div>
              {isCreatingScenario && (
                  <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-6"><div className="bg-stone-800 w-full max-w-sm rounded-xl p-6 shadow-2xl border border-stone-600"><h3 className="text-stone-200 font-bold text-lg mb-4">创建新剧场</h3><input className="w-full bg-stone-900 border border-stone-700 p-2 rounded text-white mb-3 focus:border-stone-500 focus:outline-none" placeholder="剧场标题 (e.g. 穿越古代)" value={newScenario.title || ''} onChange={e => setNewScenario({...newScenario, title: e.target.value})}/><input className="w-full bg-stone-900 border border-stone-700 p-2 rounded text-white mb-3 text-sm focus:border-stone-500 focus:outline-none" placeholder="简介" value={newScenario.description || ''} onChange={e => setNewScenario({...newScenario, description: e.target.value})}/><textarea className="w-full bg-stone-900 border border-stone-700 p-2 rounded text-white mb-3 text-xs h-24 focus:border-stone-500 focus:outline-none" placeholder="剧场世界观/System Prompt..." value={newScenario.systemPrompt || ''} onChange={e => setNewScenario({...newScenario, systemPrompt: e.target.value})}/><div className="flex items-center justify-between mb-6 bg-stone-900 p-2 rounded border border-stone-700"><div><div className="text-sm font-bold text-stone-300">关联主线记忆</div><div className="text-[10px] text-stone-500">开启后AI记得主线发生的事</div></div><input type="checkbox" className="accent-stone-600 w-5 h-5" checked={newScenario.isConnected ?? true} onChange={e => setNewScenario({...newScenario, isConnected: e.target.checked})}/></div><div className="flex gap-3"><button onClick={() => setIsCreatingScenario(false)} className="flex-1 py-2 bg-stone-700 rounded text-stone-300">取消</button><button onClick={handleCreateScenario} className="flex-1 py-2 bg-stone-600 rounded text-white font-bold">创建</button></div></div></div>
              )}
          </div>
      );
  }

  // --- 2. THEATER ROOM VIEW ---
  if (viewMode === 'theater_room' && activeScenario) {
      const messagesToShow = activeScenario.isConnected ? character.messages.filter(m => m.scenarioId === activeScenario.id) : (activeScenario.messages || []);
      return (
          <div className="flex flex-col h-full relative text-black" style={{ backgroundImage: activeScenario.wallpaper ? `url(${activeScenario.wallpaper})` : undefined, backgroundColor: activeScenario.wallpaper ? undefined : '#292524', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
              <div className="absolute inset-0 bg-stone-900/30 pointer-events-none z-0"></div>
              <div className="p-3 bg-stone-900/80 backdrop-blur text-white flex justify-between items-center sticky top-0 z-20 border-b border-stone-700">
                   <div className="flex items-center gap-2"><button onClick={exitTheater} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-chevron-left"></i></button><div><div className="font-bold text-stone-200 text-sm flex items-center gap-2">{activeScenario.title}<span className="text-[10px] bg-stone-700 px-1 rounded text-stone-300">{activeScenario.isConnected ? '关联' : '独立'}</span></div><div className="text-[10px] text-stone-400">{character.remark}</div></div></div>
                   <button onClick={() => setShowScenarioSettings(true)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"><i className="fas fa-cog"></i></button>
              </div>
              {renderImmersiveList(messagesToShow, '#f59e0b')}
              {quotingMsg && (<div className="bg-stone-800 px-3 py-2 flex justify-between items-center text-xs text-stone-300 border-t border-stone-600 relative z-20"><div className="truncate max-w-[85%]">引用: {quotingMsg.content}</div><button onClick={() => setQuotingMsg(null)}><i className="fas fa-times"></i></button></div>)}
              <div className="bg-stone-900 p-3 border-t border-stone-700 relative z-20 flex gap-2">
                  <input value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyDown={e => { if(e.key === 'Enter') handleSend(true); }} className="flex-1 bg-stone-800 border border-stone-600 rounded-full px-4 text-white focus:outline-none focus:border-stone-500" placeholder="发送剧场消息..."/>
                  <button onClick={() => handleSend(true)} className="w-10 h-10 rounded-full bg-stone-700 text-white flex items-center justify-center font-bold"><i className="fas fa-paper-plane"></i></button>
              </div>
              {renderCommonModals()}
              {showScenarioSettings && (<div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-6"><div className="bg-stone-800 w-full max-w-sm rounded-xl p-6 shadow-2xl border border-stone-600 animate-slide-up"><h3 className="text-stone-200 font-bold mb-4">剧场设置</h3><div className="space-y-4"><div><label className="text-xs text-stone-400 font-bold uppercase">System Prompt</label><textarea className="w-full h-24 bg-stone-900 border border-stone-700 rounded p-2 text-xs text-stone-300 focus:border-stone-500 focus:outline-none" value={activeScenario.systemPrompt} onChange={e => updateActiveScenario({ systemPrompt: e.target.value })}/></div>{!activeScenario.isConnected && (<div><label className="text-xs text-stone-400 font-bold uppercase">独立上下文</label><textarea className="w-full h-16 bg-stone-900 border border-stone-700 rounded p-2 text-xs text-stone-300 focus:border-stone-500 focus:outline-none" value={activeScenario.contextMemory || ''} onChange={e => updateActiveScenario({ contextMemory: e.target.value })}/></div>)}<div><label className="text-xs text-stone-400 font-bold uppercase">剧场壁纸</label><input type="file" accept="image/*" onChange={handleOfflineBackgroundUpload} className="text-xs text-stone-500 w-full mt-1"/></div><div><label className="text-xs uppercase font-bold text-stone-500">单页加载消息数: {tempCharConfig.renderMessageLimit || 50}</label><input type="range" min="20" max="100" step="10" value={tempCharConfig.renderMessageLimit || 50} onChange={(e) => setTempCharConfig({...tempCharConfig, renderMessageLimit: parseInt(e.target.value)})} className="w-full accent-stone-600 h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer mt-1"/></div></div><div className="flex gap-2 mt-6"><button onClick={() => setShowScenarioSettings(false)} className="flex-1 py-2 bg-stone-700 text-stone-200 rounded font-bold">关闭</button><button onClick={saveCharSettings} className="flex-1 py-2 bg-stone-600 text-white font-bold rounded">保存</button></div></div></div>)}
          </div>
      );
  }

  // --- 3. OFFLINE VIEW ---
  if (viewMode === 'offline') {
      const bgStyle = character.offlineConfig.bgUrl ? { backgroundImage: `url(${character.offlineConfig.bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : { backgroundColor: '#1c1917' };
      const offlineMessages = character.messages.filter(m => m.mode === 'offline');
      
      return (
          <div className="flex flex-col h-full relative text-stone-200 font-serif" style={bgStyle}>
               <div className="absolute inset-0 bg-black/40 pointer-events-none z-0"></div>
               <div className="p-4 flex justify-between items-center sticky top-0 z-20">
                    <button onClick={exitOfflineMode} className="bg-black/20 backdrop-blur rounded-full w-10 h-10 flex items-center justify-center text-white/80 hover:bg-black/40 transition"><i className="fas fa-sign-out-alt"></i></button>
                    <button onClick={() => setShowOfflineSettings(true)} className="bg-black/20 backdrop-blur rounded-full w-10 h-10 flex items-center justify-center text-white/80 hover:bg-black/40 transition"><i className="fas fa-sliders-h"></i></button>
               </div>
               {renderImmersiveList(offlineMessages, character.offlineConfig.indicatorColor)}
               <div className="p-4 bg-stone-950 border-t border-stone-800 relative z-20">
                   <div className="relative">
                       <textarea value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(true); } }} className="w-full bg-stone-900 text-stone-300 border border-stone-700 rounded-lg p-3 pr-12 focus:outline-none focus:border-amber-700 resize-none h-24 font-sans" placeholder="描述你的动作、语言..." disabled={isGlobalGenerating}/>
                       <button onClick={() => handleSend(true)} disabled={isGlobalGenerating} className={`absolute bottom-3 right-3 transition ${isGlobalGenerating ? 'text-gray-600' : 'text-stone-400 hover:text-white'}`}><i className="fas fa-feather-alt text-xl"></i></button>
                   </div>
               </div>
               {renderCommonModals()}
               {showOfflineSettings && (
                   <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4"><div className="bg-stone-900 border border-stone-700 w-full max-w-md rounded-lg p-6 shadow-2xl animate-slide-up text-stone-300 max-h-full overflow-y-auto"><h3 className="font-bold text-xl text-stone-200 mb-6 border-b border-stone-800 pb-2">线下模式配置</h3><div className="space-y-4 font-sans"><div><label className="text-xs uppercase font-bold text-stone-500">指示器颜色</label><div className="flex gap-2 mt-1 flex-wrap">{OFFLINE_LOADING_COLORS.map(c => (<button key={c.name} onClick={() => setTempCharConfig({...tempCharConfig, offlineConfig: {...tempCharConfig.offlineConfig, indicatorColor: c.value}})} className={`w-6 h-6 rounded-full border border-stone-600 ${tempCharConfig.offlineConfig.indicatorColor === c.value ? 'ring-2 ring-white scale-110' : ''}`} style={{ backgroundColor: c.value }}/>))}</div></div><div><label className="text-xs uppercase font-bold text-stone-500">文风设定</label><input value={tempCharConfig.offlineConfig.style} onChange={e => setTempCharConfig({...tempCharConfig, offlineConfig: {...tempCharConfig.offlineConfig, style: e.target.value}})} className="w-full bg-stone-800 border-stone-700 rounded p-2 mt-1 focus:outline-none focus:border-stone-500"/></div><div><label className="text-xs uppercase font-bold text-stone-500">回复字数限制</label><input type="number" value={tempCharConfig.offlineConfig.wordCount} onChange={e => setTempCharConfig({...tempCharConfig, offlineConfig: {...tempCharConfig.offlineConfig, wordCount: parseInt(e.target.value) || 150}})} className="w-full bg-stone-800 border-stone-700 rounded p-2 mt-1 focus:outline-none focus:border-stone-500" placeholder="150"/></div><div><label className="text-xs uppercase font-bold text-stone-500">单页加载消息数: {tempCharConfig.renderMessageLimit || 50}</label><input type="range" min="20" max="100" step="10" value={tempCharConfig.renderMessageLimit || 50} onChange={(e) => setTempCharConfig({...tempCharConfig, renderMessageLimit: parseInt(e.target.value)})} className="w-full accent-stone-600 h-2 bg-stone-700 rounded-lg appearance-none cursor-pointer mt-1"/></div><div><label className="text-xs uppercase font-bold text-stone-500">场景壁纸</label><div className="flex items-center gap-2 mt-1"><div className="w-12 h-12 bg-stone-800 border border-stone-700 rounded overflow-hidden">{tempCharConfig.offlineConfig.bgUrl ? <img src={tempCharConfig.offlineConfig.bgUrl} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs text-stone-600">无</div>}</div><input type="file" accept="image/*" onChange={handleOfflineBackgroundUpload} className="flex-1 text-xs text-stone-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-stone-700 file:text-stone-300"/></div></div><div><label className="text-xs uppercase font-bold text-stone-500">System Prompt</label><textarea value={tempCharConfig.offlineConfig.systemPrompt} onChange={e => setTempCharConfig({...tempCharConfig, offlineConfig: {...tempCharConfig.offlineConfig, systemPrompt: e.target.value}})} className="w-full bg-stone-800 border-stone-700 rounded p-2 mt-1 h-32 text-xs font-mono focus:outline-none focus:border-stone-500"/></div></div><div className="mt-6 flex gap-3"><button onClick={() => setShowOfflineSettings(false)} className="flex-1 py-2 bg-stone-800 rounded hover:bg-stone-700">取消</button><button onClick={saveCharSettings} className="flex-1 py-2 bg-stone-700 text-white font-bold rounded hover:bg-stone-600">保存生效</button></div></div></div>
               )}
          </div>
      );
  }

  // --- 4. STANDARD CHAT VIEW ---
  return (
    <div className="flex flex-col h-full relative text-black" style={{ backgroundImage: character.chatBackground ? `url(${character.chatBackground})` : undefined, backgroundColor: character.chatBackground ? undefined : '#ededed', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
      <div className="bg-[#ededed]/80 backdrop-blur-md border-b border-gray-200/50 p-3 flex items-center justify-between sticky top-0 z-20 h-[60px] shadow-sm">
        <div className="flex items-center">
          <button onClick={onBack} className="mr-3 text-gray-800 active:text-gray-500"><i className="fas fa-chevron-left text-lg"></i></button>
          <div className="flex flex-col cursor-pointer select-none" onDoubleClick={handlePat}>
            <span className="font-bold text-gray-900 text-base">{character.remark}</span>
            {isTyping && <span className="text-[10px] text-gray-500">对方正在输入...</span>}
          </div>
        </div>
        <div className="flex gap-4"><button onClick={() => setShowOSModal(true)} className={`w-8 h-8 rounded-full flex items-center justify-center transition ${character.showOS ? 'text-red-900 bg-red-50' : 'text-gray-600 hover:bg-gray-200'}`}><i className="fas fa-eye"></i></button><button onClick={() => setShowMemoryFurnace(true)} className="w-8 h-8 rounded-full hover:bg-gray-200 text-gray-600 flex items-center justify-center transition"><i className="fas fa-brain"></i></button></div>
      </div>
      
      {renderChatList()}

      {quotingMsg && (<div className="bg-gray-100 px-3 py-2 flex justify-between items-center text-xs text-gray-500 border-t border-gray-200"><div className="truncate max-w-[85%]">回复 <span className="font-bold text-gray-700">{quotingMsg.role === 'model' ? character.remark : '我'}</span>: {quotingMsg.content}</div><button onClick={() => setQuotingMsg(null)}><i className="fas fa-times"></i></button></div>)}
      <div className="bg-[#f7f7f7]/80 backdrop-blur-md border-t border-gray-200 flex flex-col gap-2 relative z-20 pb-4 pt-3">
        <div className="flex items-end gap-2 px-3">
            <button onClick={() => setShowDrawer(!showDrawer)} className={`w-8 h-8 mb-1 rounded-full border text-lg flex items-center justify-center transition-all ${showDrawer ? 'rotate-45 border-stone-500 text-stone-700' : 'border-stone-400 text-stone-500'}`} disabled={isGlobalGenerating}><i className="fas fa-plus"></i></button>
            <div className="flex-1 bg-white rounded-xl shadow-sm p-2 mb-1 border border-gray-200 focus-within:border-stone-400 focus-within:ring-1 focus-within:ring-stone-100 transition-all"><textarea ref={inputRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(false); }}} disabled={isGlobalGenerating} className="w-full bg-transparent resize-none focus:outline-none text-sm max-h-20 disabled:text-gray-400 leading-relaxed" rows={1} placeholder="发消息..."/></div>
            <div className="flex flex-col gap-1 mb-1">
                <button onClick={() => handleSend(true)} disabled={isGlobalGenerating} className={`w-12 h-8 rounded-lg text-sm font-bold shadow-md transition-all flex items-center justify-center ${isGlobalGenerating ? 'bg-gray-300 text-gray-100 cursor-not-allowed' : 'bg-stone-900 text-white active:scale-95'}`}><i className="fas fa-paper-plane"></i></button>
            </div>
        </div>
        {showDrawer && (
            <div className="grid grid-cols-4 gap-6 p-6 bg-[#f7f7f7] border-t border-gray-200 animate-slide-up h-[220px] overflow-y-auto">
                 <button onClick={() => setActiveToolModal('PHOTO')} className="flex flex-col items-center gap-2 group">
                     <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200 group-active:scale-95 transition border border-gray-100">
                         <i className="fas fa-image text-2xl text-stone-700"></i>
                     </div>
                     <span className="text-[10px] font-bold text-stone-600">照片</span>
                 </button>
                 <button onClick={() => setActiveToolModal('LOCATION')} className="flex flex-col items-center gap-2 group">
                     <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200 group-active:scale-95 transition border border-gray-100">
                         <i className="fas fa-map-marker-alt text-2xl text-stone-700"></i>
                     </div>
                     <span className="text-[10px] font-bold text-stone-600">位置</span>
                 </button>
                 <button onClick={() => setActiveToolModal('TRANSFER')} className="flex flex-col items-center gap-2 group">
                     <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200 group-active:scale-95 transition border border-gray-100">
                         <i className="fas fa-yen-sign text-2xl text-stone-700"></i>
                     </div>
                     <span className="text-[10px] font-bold text-stone-600">转账</span>
                 </button>
                 <button onClick={() => setActiveToolModal('VOICE')} className="flex flex-col items-center gap-2 group">
                     <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200 group-active:scale-95 transition border border-gray-100">
                         <i className="fas fa-microphone text-2xl text-stone-700"></i>
                     </div>
                     <span className="text-[10px] font-bold text-stone-600">语音</span>
                 </button>
                 <button onClick={() => setShowCharSettings(true)} className="flex flex-col items-center gap-2 group">
                     <div className="w-14 h-14 bg-stone-900 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-stone-200 group-active:scale-95 transition border border-stone-700 hover:bg-red-900">
                         <i className="fas fa-user-cog text-xl"></i>
                     </div>
                     <span className="text-[10px] font-bold text-stone-600">设置</span>
                 </button>
                 <button onClick={() => { if (viewMode === 'offline') exitOfflineMode(); else setViewMode('offline'); }} className="flex flex-col items-center gap-2 group">
                     <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition border border-stone-700 group-active:scale-95 ${viewMode === 'offline' ? 'bg-white text-stone-900 border-stone-900' : 'bg-stone-900 text-white hover:bg-red-900'}`}>
                         <i className="fas fa-street-view text-xl"></i>
                     </div>
                     <span className="text-[10px] font-bold text-stone-600">{viewMode === 'offline' ? '退出线下' : '线下模式'}</span>
                 </button>
                 <button onClick={() => setViewMode('theater_list')} className="flex flex-col items-center gap-2 group">
                     <div className="w-14 h-14 bg-stone-900 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-stone-200 group-active:scale-95 transition border border-stone-700 hover:bg-red-900">
                         <i className="fas fa-theater-masks text-xl"></i>
                     </div>
                     <span className="text-[10px] font-bold text-stone-600">小剧场</span>
                 </button>
                 <button onClick={handleForceMoment} className="flex flex-col items-center gap-2 group">
                     <div className="w-14 h-14 bg-stone-900 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-stone-200 group-active:scale-95 transition border border-stone-700 hover:bg-red-900">
                         <i className="fas fa-camera-retro text-xl"></i>
                     </div>
                     <span className="text-[10px] font-bold text-stone-600">发圈</span>
                 </button>
            </div>
        )}
      </div>
      {renderCommonModals()}
      {showCharSettings && (
          <div className="absolute inset-0 bg-gray-100 z-50 flex flex-col animate-slide-up">
              <div className="bg-white p-4 shadow-sm flex items-center justify-between sticky top-0"><button onClick={() => setShowCharSettings(false)} className="text-gray-600 font-medium">取消</button><h3 className="font-bold text-lg">聊天信息</h3><button onClick={saveCharSettings} className="bg-stone-900 text-white px-3 py-1 rounded font-bold text-sm hover:bg-stone-800">完成</button></div>
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  
                  {/* NEW: Character Profile Editing */}
                  <div className="bg-white p-4 rounded-xl shadow-sm space-y-4">
                      <div className="flex flex-col items-center">
                          <div className="relative w-20 h-20 group">
                              <img src={tempCharConfig.avatar} className="w-full h-full rounded-full object-cover border-4 border-white shadow-md" />
                              <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer">
                                  <i className="fas fa-camera text-white"></i>
                              </div>
                              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="text-xs text-gray-500 font-bold uppercase block mb-1">备注名</label>
                              <input value={tempCharConfig.remark} onChange={e => setTempCharConfig({...tempCharConfig, remark: e.target.value})} className="w-full p-2 bg-gray-50 border rounded text-sm font-bold focus:border-stone-500 focus:outline-none"/>
                          </div>
                          <div>
                              <label className="text-xs text-gray-500 font-bold uppercase block mb-1">真名 (Prompt用)</label>
                              <input value={tempCharConfig.name} onChange={e => setTempCharConfig({...tempCharConfig, name: e.target.value})} className="w-full p-2 bg-gray-50 border rounded text-sm focus:border-stone-500 focus:outline-none"/>
                          </div>
                      </div>
                  </div>

                  <div className="bg-white p-4 rounded-xl shadow-sm">
                      <div className="flex items-center justify-between"><div><h4 className="font-bold text-gray-700">本聊天室人设</h4><p className="text-xs text-gray-400">是否为此角色单独设置你的身份？</p></div><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" className="sr-only peer" checked={tempCharConfig.useLocalPersona} onChange={(e) => setTempCharConfig({...tempCharConfig, useLocalPersona: e.target.checked})}/><div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-stone-900"></div></label></div>
                      {tempCharConfig.useLocalPersona ? (
                          <div className="mt-4 pt-4 border-t border-gray-100 space-y-3 animate-fade-in"><div className="flex items-center gap-4"><div className="relative w-14 h-14"><img src={tempCharConfig.userMaskAvatar || 'https://ui-avatars.com/api/?name=U'} className="w-full h-full rounded-lg object-cover bg-gray-100" /><input type="file" accept="image/*" onChange={handleUserMaskAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer" /></div><div className="flex-1"><input value={tempCharConfig.userMaskName} onChange={e => setTempCharConfig({...tempCharConfig, userMaskName: e.target.value})} className="text-sm font-bold border-b w-full p-1 mb-2 focus:border-stone-500 focus:outline-none" placeholder="你的名字" /><input value={tempCharConfig.userMaskDescription || ''} onChange={e => setTempCharConfig({...tempCharConfig, userMaskDescription: e.target.value})} className="text-xs text-gray-500 border-b w-full p-1 focus:border-stone-500 focus:outline-none" placeholder="你的人设描述..." /></div></div></div>
                      ) : ( <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-500"><p>当前使用全局人设: <span className="font-bold">{settings.globalPersona.name}</span></p></div> )}
                  </div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2">聊天背景</h4><div className="flex items-center gap-4"><div className="w-16 h-24 bg-gray-100 border rounded overflow-hidden">{tempCharConfig.chatBackground ? <img src={tempCharConfig.chatBackground} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><i className="fas fa-image"></i></div>}</div><div className="flex-1"><input type="file" accept="image/*" onChange={handleBackgroundUpload} className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-stone-50 file:text-stone-700 hover:file:bg-stone-100"/><button onClick={() => setTempCharConfig({...tempCharConfig, chatBackground: undefined})} className="text-xs text-red-900 mt-2 ml-4">清除背景</button></div></div></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm">
                      <h4 className="font-bold text-gray-700 mb-2">外观/CSS自定义</h4>
                      <div className="grid grid-cols-3 gap-2 mb-4">
                          <button onClick={() => setTempCharConfig({...tempCharConfig, styleConfig: PRESET_STYLES.pinkTransparent as StyleConfig})} className="p-2 bg-pink-100 text-pink-700 rounded text-xs font-bold border border-pink-200">粉色透明</button>
                          <button onClick={() => setTempCharConfig({...tempCharConfig, styleConfig: PRESET_STYLES.beigeTransparent as StyleConfig})} className="p-2 bg-[#fdf5e6] text-[#8b4513] rounded text-xs font-bold border border-[#deb887]">米白透明</button>
                          <button onClick={() => setTempCharConfig({...tempCharConfig, styleConfig: PRESET_STYLES.darkRedTransparent as StyleConfig})} className="p-2 bg-[#4a0404] text-red-100 rounded text-xs font-bold border border-red-900">深红透明</button>
                      </div>
                      <div className="space-y-3 text-xs">
                          <div><label className="block text-gray-500 font-bold mb-1">线上-用户气泡 CSS</label><textarea className="w-full p-2 bg-gray-50 border rounded font-mono h-16" value={tempCharConfig.styleConfig?.onlineUser || DEFAULT_STYLE_CONFIG.onlineUser} onChange={e => setTempCharConfig({...tempCharConfig, styleConfig: {...(tempCharConfig.styleConfig || DEFAULT_STYLE_CONFIG), onlineUser: e.target.value}})}/></div>
                          <div><label className="block text-gray-500 font-bold mb-1">线上-AI气泡 CSS</label><textarea className="w-full p-2 bg-gray-50 border rounded font-mono h-16" value={tempCharConfig.styleConfig?.onlineModel || DEFAULT_STYLE_CONFIG.onlineModel} onChange={e => setTempCharConfig({...tempCharConfig, styleConfig: {...(tempCharConfig.styleConfig || DEFAULT_STYLE_CONFIG), onlineModel: e.target.value}})}/></div>
                          <div><label className="block text-gray-500 font-bold mb-1">线下/剧场-AI文本 CSS</label><textarea className="w-full p-2 bg-gray-50 border rounded font-mono h-16" value={tempCharConfig.styleConfig?.offlineModel || DEFAULT_STYLE_CONFIG.offlineModel} onChange={e => setTempCharConfig({...tempCharConfig, styleConfig: {...(tempCharConfig.styleConfig || DEFAULT_STYLE_CONFIG), offlineModel: e.target.value}})}/></div>
                          <div><label className="block text-gray-500 font-bold mb-1">线下/剧场-用户文本 CSS</label><textarea className="w-full p-2 bg-gray-50 border rounded font-mono h-16" value={tempCharConfig.styleConfig?.offlineUser || DEFAULT_STYLE_CONFIG.offlineUser} onChange={e => setTempCharConfig({...tempCharConfig, styleConfig: {...(tempCharConfig.styleConfig || DEFAULT_STYLE_CONFIG), offlineUser: e.target.value}})}/></div>
                      </div>
                  </div>
                  <div className="bg-white p-4 rounded-xl shadow-sm">
                      <div className="flex items-center justify-between mb-2"><h4 className="font-bold text-gray-700">自动发朋友圈</h4><label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" className="sr-only peer" checked={tempCharConfig.autoPostMoments} onChange={(e) => setTempCharConfig({...tempCharConfig, autoPostMoments: e.target.checked})}/><div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-stone-900"></div></label></div>
                      <p className="text-xs text-gray-400">开启后，AI 会根据聊天内容自动发布朋友圈</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2 flex justify-between"><span>聊天字号 (px)</span><span className="text-stone-900">{tempCharConfig.chatFontSize || 15}</span></h4><input type="range" min="12" max="24" value={tempCharConfig.chatFontSize || 15} onChange={(e) => setTempCharConfig({...tempCharConfig, chatFontSize: parseInt(e.target.value)})} className="w-full accent-stone-900 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"/></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2 flex justify-between"><span>单页加载消息数</span><span className="text-stone-900">{tempCharConfig.renderMessageLimit || 50}</span></h4><input type="range" min="20" max="100" step="10" value={tempCharConfig.renderMessageLimit || 50} onChange={(e) => setTempCharConfig({...tempCharConfig, renderMessageLimit: parseInt(e.target.value)})} className="w-full accent-stone-900 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"/></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2">上下文记忆 (Short Term)</h4><textarea value={tempCharConfig.contextMemory} onChange={e => setTempCharConfig({...tempCharConfig, contextMemory: e.target.value})} className="w-full h-24 p-2 text-sm bg-yellow-50 border border-yellow-200 rounded focus:outline-none placeholder-yellow-300/50" placeholder="在此输入当前场景的重要信息，AI会始终记住..."/></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm flex items-center justify-between"><div><h4 className="font-bold text-gray-700">记忆回溯条数</h4><p className="text-xs text-gray-400">每次对话携带的历史消息数量</p></div><input type="number" value={tempCharConfig.historyCount || 20} onChange={e => setTempCharConfig({...tempCharConfig, historyCount: parseInt(e.target.value) || 20})} className="w-16 p-2 text-center bg-gray-100 rounded font-bold focus:outline-none focus:ring-2 focus:ring-stone-900"/></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2">角色人设 (Personality)</h4><textarea value={tempCharConfig.personality} onChange={e => setTempCharConfig({...tempCharConfig, personality: e.target.value})} className="w-full h-32 p-2 text-xs border border-gray-200 rounded focus:outline-none focus:border-stone-500 resize-none bg-gray-50" placeholder="在此设定角色的性格、语气、口癖等..." /></div>
                  <div className="bg-white p-4 rounded-xl shadow-sm"><h4 className="font-bold text-gray-700 mb-2">System Prompt</h4><textarea value={tempCharConfig.systemPrompt} onChange={e => setTempCharConfig({...tempCharConfig, systemPrompt: e.target.value})} className="w-full h-40 p-2 text-[10px] font-mono bg-gray-900 text-stone-200 rounded focus:outline-none"/></div>
                  <div className="bg-red-50 p-4 rounded-xl shadow-sm border border-red-100 mt-4"><h4 className="font-bold text-red-900 mb-2">危险区域</h4><button onClick={() => setShowClearHistoryModal(true)} className="w-full py-2 bg-white border border-red-200 text-red-900 rounded font-bold text-sm shadow-sm hover:bg-red-50 active:bg-red-100 transition"><i className="fas fa-trash-alt mr-2"></i> 清空该角色聊天记录</button></div>
              </div>
          </div>
      )}
      
      {/* Transfer Action Modal - RESTRICTED TO MODEL MESSAGES */}
      {transferActionMsg && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => setTransferActionMsg(null)}>
              <div className="bg-white w-full max-w-xs rounded-xl p-6 shadow-2xl animate-slide-up relative text-center" onClick={e => e.stopPropagation()}>
                  <div className="w-14 h-14 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"><i className="fas fa-yen-sign"></i></div>
                  <h3 className="text-gray-900 font-bold text-lg mb-1">交易操作</h3>
                  <p className="text-gray-500 text-xs mb-6">¥{Number(transferActionMsg.meta?.amount).toFixed(2)} - {transferActionMsg.content}</p>
                  <div className="flex flex-col gap-3">
                      <button onClick={() => handleTransferStatusUpdate('received')} className="w-full py-3 bg-[#07c160] text-white rounded-xl font-bold hover:opacity-90">确认收款</button>
                      <button onClick={() => handleTransferStatusUpdate('refunded')} className="w-full py-3 bg-red-50 text-red-600 rounded-xl font-bold hover:bg-red-100">立即退款</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default ChatInterface;