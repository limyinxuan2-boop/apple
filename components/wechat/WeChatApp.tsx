

import React, { useState, useEffect, useRef, Dispatch, SetStateAction } from 'react';
import { Character, AppSettings, WeChatTab, Message, Moment, Comment } from '../../types';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_OFFLINE_PROMPT, DEFAULT_OS_PROMPT, MOMENT_REPLY_PROMPT } from '../../constants';
import { generateChatCompletion, interpolatePrompt } from '../../services/aiService';
import ChatInterface from './ChatInterface';

interface WeChatAppProps {
  settings: AppSettings;
  onUpdateSettings: Dispatch<SetStateAction<AppSettings>>;
  characters: Character[];
  onUpdateCharacters: Dispatch<SetStateAction<Character[]>>;
  onClose: () => void;
}

interface NotificationState {
  show: boolean;
  charId: string;
  charName: string;
  avatar: string;
  message: string;
}

// --- Helper: Check if string is a URL or Base64 Image ---
const isImageContent = (str: string) => {
    if (!str) return false;
    // Basic check for URL or Data URI
    return str.startsWith('http') || str.startsWith('data:image') || str.startsWith('blob:') || str.match(/\.(jpeg|jpg|gif|png)$/) != null;
};

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
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};

const WeChatApp: React.FC<WeChatAppProps> = ({ settings, onUpdateSettings, characters, onUpdateCharacters, onClose }) => {
  const [activeTab, setActiveTab] = useState<WeChatTab>(WeChatTab.CHATS);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const charactersRef = useRef(characters);
  const settingsRef = useRef(settings);
  
  const [notification, setNotification] = useState<NotificationState | null>(null);
  const [globalIsGenerating, setGlobalIsGenerating] = useState(false);
  const [contextMenuCharId, setContextMenuCharId] = useState<string | null>(null);
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newChar, setNewChar] = useState<Partial<Character>>({});
  const [tempGlobalPersona, setTempGlobalPersona] = useState(settings.globalPersona);
  const [isSavingPersona, setIsSavingPersona] = useState(false);
  
  // Moments State
  const [isPostingMoment, setIsPostingMoment] = useState(false);
  const [newMomentContent, setNewMomentContent] = useState('');
  const [newMomentImages, setNewMomentImages] = useState<string[]>([]);
  const [momentVisibility, setMomentVisibility] = useState<string[]>([]); 
  const [showVisibilitySelector, setShowVisibilitySelector] = useState(false);
  const [isRefreshingMoments, setIsRefreshingMoments] = useState(false);
  const [activeInteractionId, setActiveInteractionId] = useState<string | null>(null);
  
  // Imagined Photo Input State
  const [showImaginedInput, setShowImaginedInput] = useState(false);
  const [tempImaginedText, setTempImaginedText] = useState('');

  // Moments Interaction State
  const [viewingPhotoDesc, setViewingPhotoDesc] = useState<string | null>(null);
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState<{momentId: string, isUserMoment: boolean} | null>(null);
  const [commentText, setCommentText] = useState('');
  
  // Red Dot
  const [hasNewMoment, setHasNewMoment] = useState(false);
  const prevMomentsCountRef = useRef(0);

  const longPressTimerRef = useRef<any>(null);
  const isLongPressRef = useRef(false);

  useEffect(() => { setTempGlobalPersona(settings.globalPersona); }, [settings.globalPersona]);
  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
  useEffect(() => { charactersRef.current = characters; }, [characters]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Check for new moments to show Red Dot
  useEffect(() => {
      const totalMoments = characters.reduce((acc, c) => acc + (c.moments ? c.moments.length : 0), 0) 
                         + (settings.globalPersona.moments ? settings.globalPersona.moments.length : 0);
      
      // Initialize ref if first run
      if (prevMomentsCountRef.current === 0 && totalMoments > 0) {
          prevMomentsCountRef.current = totalMoments;
      }
      
      if (totalMoments > prevMomentsCountRef.current) {
          setHasNewMoment(true);
      }
      prevMomentsCountRef.current = totalMoments;
  }, [characters, settings.globalPersona.moments]);

  const handleAddMessage = (charId: string, message: Message) => {
      onUpdateCharacters((prevChars: Character[]) => {
          return prevChars.map(c => {
              if (c.id === charId) {
                  return { ...c, messages: [...c.messages, message] };
              }
              return c;
          });
      });

      if (activeChatIdRef.current !== charId && message.role === 'model' && !message.isHidden) {
          const char = characters.find(c => c.id === charId);
          if (char) {
              setNotification({ show: true, charId: char.id, charName: char.remark, avatar: char.avatar, message: message.content });
              setTimeout(() => { setNotification(prev => prev?.charId === charId ? null : prev); }, 3000);
          }
      }
  };

  const handleShowNotification = (text: string) => {
      setNotification({
          show: true,
          charId: 'system',
          charName: '朋友圈',
          avatar: 'https://ui-avatars.com/api/?name=M&background=random',
          message: text
      });
      setTimeout(() => setNotification(null), 3000);
  };

  const handleNotificationClick = () => {
      if (notification && notification.charId !== 'system') { 
          setActiveChatId(notification.charId); 
      } else if (notification && notification.charId === 'system') {
          setActiveTab(WeChatTab.MOMENTS);
          setHasNewMoment(false);
      }
      setNotification(null);
  };

  const handleCreateChar = () => {
    if (!newChar.name || !newChar.remark) { alert("请至少填写【名字】和【备注】"); return; }
    const char: Character = {
      id: Date.now().toString(),
      name: newChar.name,
      remark: newChar.remark,
      avatar: newChar.avatar || 'https://ui-avatars.com/api/?name=' + newChar.remark + '&background=random',
      description: newChar.description || '',
      personality: newChar.personality || '友好的助手',
      systemPrompt: newChar.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      osSystemPrompt: DEFAULT_OS_PROMPT,
      showOS: false,
      useLocalPersona: false,
      userMaskName: '用户', 
      chatFontSize: 15,
      contextMemory: '',
      historyCount: 20,
      renderMessageLimit: 50,
      furnaceConfig: { autoEnabled: false, autoThreshold: 20, autoScope: 30, manualScope: 30 },
      offlineConfig: { systemPrompt: DEFAULT_OFFLINE_PROMPT, style: '细腻、沉浸、小说感', wordCount: 150, bgUrl: '', indicatorColor: '#f59e0b' },
      scenarios: [], memories: [], messages: [], diaries: [], moments: [], autoPostMoments: true, unread: 0,
      realTimeMode: false
    };
    onUpdateCharacters((prev) => [...prev, char]);
    setIsCreating(false);
    setNewChar({});
    setActiveTab(WeChatTab.CHATS);
  };

  // --- MOMENTS LOGIC ---

  const getAllMoments = () => {
      const userMoments = (settings.globalPersona.moments || []).map(m => ({ ...m, isUser: true, avatar: settings.globalPersona.avatar, name: settings.globalPersona.name }));
      const charMoments = characters.flatMap(c => (c.moments || []).map(m => ({ ...m, isUser: false, avatar: c.avatar, name: c.remark })));
      return [...userMoments, ...charMoments].sort((a, b) => b.timestamp - a.timestamp);
  };

  // 1. Simulate AI Friends reacting to User's Post
  const simulateAiInteractions = async (userMomentId: string, content: string) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings.apiKey) { console.warn("No API Key for simulation"); return; }
      const currentChars = charactersRef.current;
      // Randomly select 1-3 characters to react
      const reactorCount = Math.floor(Math.random() * 3) + 1;
      const reactors = [...currentChars].sort(() => 0.5 - Math.random()).slice(0, reactorCount); 
      
      console.log(`Simulating interactions for Moment ${userMomentId}, reactors: ${reactors.map(c => c.remark).join(', ')}`);

      for (const char of reactors) {
          const delay = Math.random() * 10000 + 2000; // 2s - 12s delay
          
          setTimeout(async () => {
              // 1. Like (80% chance)
              if (Math.random() > 0.2) {
                  handleLikeMoment({ id: userMomentId, isUser: true } as any, char.id);
              }
              
              // 2. Comment (50% chance)
              if (Math.random() > 0.5) {
                  try {
                      const prompt = interpolatePrompt(MOMENT_REPLY_PROMPT, { 
                          ai_name: char.name, 
                          user_name: currentSettings.globalPersona.name, 
                          moment_content: content || '[图片]', 
                          user_comment: "（这是用户发的一条朋友圈，请以好友身份回复一条评论，简短自然，不要带引号）" 
                      });
                      
                      const reply = await generateChatCompletion([{ role: 'user', content: prompt }], currentSettings);
                      const cleanReply = reply.replace(/^["']|["']$/g, '').trim();
                      
                      const newComment: Comment = { 
                          id: Date.now().toString() + char.id, 
                          authorId: char.id, 
                          authorName: char.remark, 
                          content: cleanReply, 
                          timestamp: Date.now(), 
                          isAi: true 
                      };
                      
                      // Update Global Settings (User's Moment)
                      onUpdateSettings(prev => ({ 
                          ...prev, 
                          globalPersona: { 
                              ...prev.globalPersona, 
                              moments: prev.globalPersona.moments.map(m => m.id === userMomentId ? { ...m, comments: [...m.comments, newComment] } : m) 
                          } 
                      }));
                      setHasNewMoment(true);
                  } catch (e) { console.error("AI Simulation Comment Failed", e); }
              }
          }, delay);
      }
  };

  const handlePostMoment = () => {
      if (!newMomentContent && newMomentImages.length === 0) return;
      const newMomentId = Date.now().toString();
      const newMoment: Moment = { 
          id: newMomentId, 
          authorId: 'USER', 
          content: newMomentContent, 
          timestamp: Date.now(), 
          likes: [], 
          comments: [], 
          visibleTo: momentVisibility.length > 0 ? momentVisibility : undefined,
          images: newMomentImages.length > 0 ? newMomentImages : undefined
      };
      
      onUpdateSettings(prev => ({ ...prev, globalPersona: { ...prev.globalPersona, moments: [newMoment, ...(prev.globalPersona.moments || [])] } }));
      setIsPostingMoment(false);
      handleShowNotification("发布成功！");
      
      // Trigger Simulation
      simulateAiInteractions(newMomentId, newMomentContent);
      
      setNewMomentContent('');
      setNewMomentImages([]);
      setMomentVisibility([]);
  };

  const handleAddMomentImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          try {
              const compressed = await compressImage(file);
              setNewMomentImages(prev => [...prev, compressed]);
          } catch(e) { alert("图片处理失败"); }
      }
  };

  // Open the Imagined Photo Modal
  const handleAddMomentImagined = () => {
      setTempImaginedText('');
      setShowImaginedInput(true);
  };

  // Confirm adding the imagined photo to the preview list
  const confirmImaginedImage = () => {
      if (tempImaginedText.trim()) {
          setNewMomentImages(prev => [...prev, tempImaginedText.trim()]);
      }
      setShowImaginedInput(false);
      setTempImaginedText('');
  };

  // Called by ChatInterface when AI sends [MOMENT: ...]
  const handleAIForceMoment = (content: string, images?: string[]) => {
      if (!activeChatId) return;
      const charId = activeChatId;
      console.log("AI Posting Moment Triggered:", content, images);
      
      const newMoment: Moment = {
          id: Date.now().toString(),
          authorId: charId,
          content: content,
          timestamp: Date.now(),
          images: images,
          likes: [],
          comments: []
      };
      
      // Update Characters State
      onUpdateCharacters(prev => prev.map(c => {
          if (c.id === charId) {
             // Append new moment
             return { ...c, moments: [newMoment, ...(c.moments || [])] };
          }
          return c;
      }));
      
      const charName = characters.find(c=>c.id === charId)?.remark || 'AI';
      handleShowNotification(`${charName} 发布了朋友圈`);
      setHasNewMoment(true);
  };

  const handleLikeMoment = (moment: Moment & { isUser: boolean }, likerId: string = 'USER') => {
      // Toggle Like Logic
      const updateLikes = (m: Moment) => {
          const isLiked = m.likes.includes(likerId);
          return isLiked ? m.likes.filter(id => id !== likerId) : [...m.likes, likerId];
      };

      if (moment.isUser) {
          onUpdateSettings(curr => ({ 
              ...curr, 
              globalPersona: { 
                  ...curr.globalPersona, 
                  moments: curr.globalPersona.moments.map(xm => xm.id === moment.id ? { ...xm, likes: updateLikes(xm) } : xm) 
              } 
          }));
      } else {
          // Find owner of the moment
          onUpdateCharacters(prev => prev.map(c => {
              // Check if this char owns the moment
              if (c.moments && c.moments.some(m => m.id === moment.id)) {
                  return {
                      ...c,
                      moments: c.moments.map(m => m.id === moment.id ? { ...m, likes: updateLikes(m) } : m)
                  };
              }
              return c;
          }));
      }
      setActiveInteractionId(null);
  };

  // 2. Handle User Submitting Comment (Triggers AI Reply if needed)
  const submitComment = async () => {
      if (!commentInput || !commentText) return;
      const { momentId, isUserMoment } = commentInput;
      
      const newComment: Comment = { 
          id: Date.now().toString(), 
          authorId: 'USER', 
          authorName: settings.globalPersona.name, 
          content: commentText, 
          timestamp: Date.now() 
      };

      // A. Update Local State First
      if (isUserMoment) {
          onUpdateSettings(prev => ({ ...prev, globalPersona: { ...prev.globalPersona, moments: prev.globalPersona.moments.map(m => m.id === momentId ? { ...m, comments: [...m.comments, newComment] } : m) } }));
      } else {
          // Find the character who owns this moment
          const char = characters.find(c => c.moments && c.moments.some(m => m.id === momentId));
          if (char) {
              onUpdateCharacters(prev => prev.map(c => c.id === char.id ? { ...c, moments: c.moments.map(m => m.id === momentId ? { ...m, comments: [...m.comments, newComment] } : m) } : c));
              
              // B. Trigger AI Reply Logic
              if (settings.apiKey) {
                  const targetMoment = char.moments.find(m => m.id === momentId);
                  
                  // Construct prompt for AI to reply to user comment
                  const prompt = interpolatePrompt(MOMENT_REPLY_PROMPT, { 
                      ai_name: char.name, 
                      user_name: settings.globalPersona.name, 
                      moment_content: targetMoment?.content || '[图片]', 
                      user_comment: commentText 
                  });
                  
                  try {
                      // Slight delay for realism
                      setTimeout(async () => {
                          const reply = await generateChatCompletion([{ role: 'user', content: prompt }], settings);
                          const cleanReply = reply.replace(/^["']|["']$/g, '').trim();

                          const aiReplyComment: Comment = { 
                              id: (Date.now() + 10).toString(), 
                              authorId: char.id, 
                              authorName: char.remark, 
                              content: cleanReply, 
                              timestamp: Date.now(), 
                              isAi: true 
                          };
                          
                          // Append AI Reply
                          onUpdateCharacters(prev => prev.map(c => c.id === char.id ? { ...c, moments: c.moments.map(m => m.id === momentId ? { ...m, comments: [...m.comments, aiReplyComment] } : m) } : c));
                          setHasNewMoment(true);
                      }, 2000);
                  } catch (e) { console.error("AI Reply to Comment Failed", e); }
              }
          }
      }
      
      setCommentInput(null);
      setCommentText('');
      setActiveInteractionId(null);
  };

  const handleRefreshMoments = () => { setIsRefreshingMoments(true); setTimeout(() => setIsRefreshingMoments(false), 1000); };
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => { if (reader.result) setNewChar(prev => ({ ...prev, avatar: reader.result as string })); }; reader.readAsDataURL(file); } };
  const handleGlobalAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onloadend = () => { if (reader.result) setTempGlobalPersona(prev => ({ ...prev, avatar: reader.result as string })); }; reader.readAsDataURL(file); } };
  const saveGlobalPersona = () => { onUpdateSettings(prev => ({ ...prev, globalPersona: tempGlobalPersona })); setIsSavingPersona(true); setTimeout(() => setIsSavingPersona(false), 1500); };
  
  const updateActiveCharacter = (updatedOrFn: Character | ((prev: Character) => Character)) => {
    onUpdateCharacters((prevChars) => prevChars.map(c => {
        if (c.id === activeChatId) {
            return typeof updatedOrFn === 'function' ? updatedOrFn(c) : updatedOrFn;
        }
        return c;
    }));
  };

  const handleTogglePin = () => { if (!contextMenuCharId) return; onUpdateCharacters((prev) => prev.map(c => { if (c.id === contextMenuCharId) return { ...c, isPinned: !c.isPinned }; return c; })); setContextMenuCharId(null); }
  
  const executeDeleteChar = () => { 
      if (!contextMenuCharId) return; 
      const targetId = contextMenuCharId;
      if (activeChatId === targetId) setActiveChatId(null);
      onUpdateCharacters((prev) => prev.filter(c => c.id !== targetId)); 
      setContextMenuCharId(null); 
      setIsDeleteConfirming(false);
  };

  const handleTouchStart = (charId: string) => { 
      isLongPressRef.current = false;
      longPressTimerRef.current = setTimeout(() => { 
          isLongPressRef.current = true; 
          setContextMenuCharId(charId); 
          setIsDeleteConfirming(false); 
      }, 600); 
  };
  
  const handleTouchEnd = () => { 
      if (longPressTimerRef.current) { 
          clearTimeout(longPressTimerRef.current); 
          longPressTimerRef.current = null; 
      } 
  };

  const activeCharacter = characters.find(c => c.id === activeChatId);
  const NotificationBubble = () => ( notification ? ( <div onClick={handleNotificationClick} className="absolute top-2 left-2 right-2 bg-white/95 backdrop-blur-md shadow-2xl rounded-2xl p-3 z-[100] flex items-center gap-3 animate-slide-up cursor-pointer border border-stone-200 ring-1 ring-black/5"><img src={notification.avatar} className="w-10 h-10 rounded-full object-cover shadow-sm" /><div className="flex-1 min-w-0"><div className="flex justify-between items-center mb-0.5"><span className="font-bold text-sm text-stone-900">{notification.charName}</span><span className="text-[10px] text-stone-400 bg-stone-50 px-1 rounded">刚刚</span></div><p className="text-xs text-stone-600 truncate">{notification.message}</p></div></div> ) : null );

  if (activeChatId && activeCharacter) {
    return (
      <div className="h-full relative">
        <ChatInterface 
            character={activeCharacter} settings={settings} onBack={() => setActiveChatId(null)} 
            onUpdateCharacter={updateActiveCharacter} 
            onAddMessage={handleAddMessage} isGlobalGenerating={globalIsGenerating} setGlobalGenerating={setGlobalIsGenerating}
            onShowNotification={handleShowNotification}
            onPostMoment={handleAIForceMoment}
        />
        <NotificationBubble />
      </div>
    );
  }

  const renderContent = () => {
    if (isCreating) {
      return (
        <div className="p-4 overflow-y-auto h-full pb-20 bg-gray-50/50 no-scrollbar">
           <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold text-stone-800">新建联系人</h2><button onClick={() => setIsCreating(false)} className="text-stone-500 hover:bg-stone-200 rounded-full w-8 h-8 flex items-center justify-center"><i className="fas fa-times"></i></button></div>
           <div className="space-y-4 bg-white/80 backdrop-blur-md p-6 rounded-2xl shadow-sm border border-white">
             <div className="flex flex-col items-center mb-4"><div className="relative w-24 h-24 rounded-2xl overflow-hidden bg-stone-100 border-2 border-dashed border-stone-300 mb-2 group shadow-inner hover:border-red-900 transition">{newChar.avatar ? <img src={newChar.avatar} className="w-full h-full object-cover" /> : <div className="flex items-center justify-center h-full text-stone-300"><i className="fas fa-camera text-3xl"></i></div>}<input type="file" accept="image/*" onChange={handleAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer"/></div><span className="text-xs text-stone-400 font-bold">点击设置头像</span></div>
             <div><label className="block text-xs font-bold text-stone-500 mb-1 uppercase tracking-wider">角色真名</label><input className="w-full p-3 border border-stone-200 rounded-xl bg-stone-50 focus:bg-white focus:border-red-900 focus:ring-2 focus:ring-red-100 transition outline-none" placeholder="例如: 诸葛亮" value={newChar.name || ''} onChange={e => setNewChar({...newChar, name: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-stone-500 mb-1 uppercase tracking-wider">备注名</label><input className="w-full p-3 border border-stone-200 rounded-xl bg-stone-50 focus:bg-white focus:border-red-900 focus:ring-2 focus:ring-red-100 transition outline-none" placeholder="例如: 丞相" value={newChar.remark || ''} onChange={e => setNewChar({...newChar, remark: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-stone-500 mb-1 uppercase tracking-wider">性格/人设描述</label><textarea className="w-full p-3 border border-stone-200 rounded-xl bg-stone-50 focus:bg-white focus:border-red-900 focus:ring-2 focus:ring-red-100 transition outline-none h-24 text-sm" placeholder="描述角色的性格..." value={newChar.personality || ''} onChange={e => setNewChar({...newChar, personality: e.target.value})} /></div>
             <div><label className="block text-xs font-bold text-stone-500 mb-1 uppercase tracking-wider">System Prompt</label><textarea className="w-full p-3 border border-stone-900 rounded-xl bg-stone-900 text-stone-200 h-40 text-[10px] font-mono leading-relaxed focus:ring-2 focus:ring-green-900 outline-none" value={newChar.systemPrompt || DEFAULT_SYSTEM_PROMPT} onChange={e => setNewChar({...newChar, systemPrompt: e.target.value})} /></div>
             <div className="flex gap-3 pt-4"><button onClick={() => setIsCreating(false)} className="flex-1 py-3 rounded-xl bg-stone-100 text-stone-600 font-bold hover:bg-stone-200 transition">取消</button><button onClick={handleCreateChar} className="flex-1 py-3 rounded-xl bg-stone-900 text-white font-bold shadow-lg shadow-stone-200 hover:shadow-xl hover:scale-[1.02] transition">完成创建</button></div>
           </div>
        </div>
      )
    }

    if (activeTab === WeChatTab.CHATS) {
      const sortedChars = [...characters].sort((a, b) => { if (a.isPinned === b.isPinned) return 0; return a.isPinned ? -1 : 1; });
      return (
        <div className="h-full overflow-y-auto no-scrollbar pt-2 pb-20">
          {sortedChars.map(char => {
             const lastMsg = [...char.messages].filter(m => (!m.mode || m.mode === 'online') && m.mode !== 'offline' && m.mode !== 'theater' && !m.isHidden).pop();
             return (
               <div key={char.id} 
                onClick={() => {
                    if (isLongPressRef.current) return;
                    setActiveChatId(char.id);
                }} 
                onContextMenu={(e) => { e.preventDefault(); setContextMenuCharId(char.id); setIsDeleteConfirming(false); }} 
                onMouseDown={() => handleTouchStart(char.id)} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchEnd} onTouchStart={() => handleTouchStart(char.id)} onTouchEnd={handleTouchEnd} 
                className={`
                    relative flex items-center p-4 mx-3 mb-3 rounded-2xl cursor-pointer select-none transition-all duration-200 group
                    ${char.isPinned ? 'bg-stone-100 border border-stone-200' : 'bg-white/80 border border-white'}
                    hover:bg-white hover:shadow-md hover:-translate-y-0.5 backdrop-blur-sm shadow-sm
                `}>
                 <div className="relative pointer-events-none mr-4">
                    <img src={char.avatar} className={`w-14 h-14 rounded-full object-cover bg-stone-200 shadow-sm ${char.isPinned ? 'ring-2 ring-stone-300' : ''}`} />
                    {char.unread ? <div className="absolute -top-1 right-0 w-4 h-4 bg-red-600 rounded-full border-2 border-white shadow-sm"></div> : null}
                 </div>
                 <div className="flex-1 min-w-0 pointer-events-none">
                   <div className="flex justify-between items-baseline mb-1">
                       <h3 className={`font-bold text-base truncate flex items-center gap-1 ${char.isPinned ? 'text-stone-900' : 'text-stone-800'}`}>
                           {char.remark}
                           {char.isPinned && <i className="fas fa-thumbtack text-[10px] text-stone-400 rotate-45 ml-1"></i>}
                       </h3>
                       <span className="text-[10px] text-stone-400 flex-shrink-0 font-medium bg-stone-50 px-1.5 py-0.5 rounded-full">
                           {lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                       </span>
                   </div>
                   <p className="text-sm text-stone-500 truncate font-medium opacity-80">
                       {lastMsg ? (lastMsg.isRecalled ? '对方撤回了一条消息' : lastMsg.content) : '暂无消息'}
                   </p>
                 </div>
                 <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-stone-300">
                     <i className="fas fa-chevron-right"></i>
                 </div>
               </div>
             )
          })}
          {characters.length === 0 && (
              <div className="flex flex-col items-center justify-center mt-20 text-stone-400 gap-4 opacity-50">
                  <i className="fas fa-comments text-6xl"></i>
                  <span className="text-sm font-bold">暂无聊天，请去通讯录添加好友</span>
              </div>
          )}
        </div>
      );
    }

    if (activeTab === WeChatTab.CONTACTS) {
       return (
         <div className="h-full overflow-y-auto no-scrollbar p-0 pb-20">
            <div onClick={() => setIsCreating(true)} className="flex items-center p-4 mx-3 mt-3 bg-white/80 backdrop-blur rounded-2xl border border-white shadow-sm active:scale-95 transition-all cursor-pointer mb-6 group">
                <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mr-4 text-white shadow-lg shadow-stone-300 group-hover:shadow-stone-400 transition-all">
                    <i className="fas fa-user-plus text-lg"></i>
                </div>
                <span className="font-bold text-stone-800">新的朋友 / 创建角色</span>
                <i className="fas fa-chevron-right ml-auto text-stone-300"></i>
            </div>
            
            <div className="px-6 mb-2 text-xs font-bold text-stone-400 uppercase tracking-widest">我的联系人</div>
            
            <div className="space-y-2 px-3">
                {characters.map(char => ( 
                    <div key={char.id} className="flex items-center p-3 bg-white/60 backdrop-blur-sm border border-transparent hover:border-white hover:bg-white rounded-xl cursor-pointer select-none transition-all" 
                        onClick={() => { if(isLongPressRef.current) return; setActiveChatId(char.id); }} 
                        onContextMenu={(e) => { e.preventDefault(); setContextMenuCharId(char.id); setIsDeleteConfirming(false); }} 
                        onMouseDown={() => handleTouchStart(char.id)} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchEnd} onTouchStart={() => handleTouchStart(char.id)} onTouchEnd={handleTouchEnd}
                    >
                        <img src={char.avatar} className="w-10 h-10 rounded-full mr-4 object-cover pointer-events-none shadow-sm" />
                        <span className="font-bold text-stone-700 pointer-events-none">{char.remark}</span>
                    </div> 
                ))}
            </div>
         </div>
       )
    }

    if (activeTab === WeChatTab.MOMENTS) {
        const moments = getAllMoments();
        return (
            <div className="h-full bg-white relative flex flex-col" onClick={() => setActiveInteractionId(null)}>
                <div className="flex-1 overflow-y-auto no-scrollbar pb-20">
                    {/* Header */}
                    <div className="relative h-72 mb-8">
                        <div className="w-full h-full relative overflow-hidden bg-stone-900 group">
                            <img src="https://picsum.photos/800/400?grayscale" className="w-full h-full object-cover opacity-60 scale-110 blur-[2px]" />
                            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/60"></div>
                        </div>
                        <div className="absolute bottom-[-30px] right-6 flex items-end gap-4 z-10">
                            <span className="text-white font-bold text-xl text-shadow-lg mb-8 tracking-wide">{settings.globalPersona.name}</span>
                            <div className="w-24 h-24 rounded-2xl border-[3px] border-white bg-white shadow-xl overflow-hidden cursor-pointer" onClick={() => setIsPostingMoment(true)}>
                                <img src={settings.globalPersona.avatar} className="w-full h-full object-cover" />
                            </div>
                        </div>
                    </div>
                    
                    {/* Action Buttons */}
                    <div className="absolute top-4 right-4 z-20 flex gap-4">
                        <button onClick={handleRefreshMoments} className={`w-8 h-8 bg-black/20 backdrop-blur-md rounded-full text-white flex items-center justify-center hover:bg-black/40 transition ${isRefreshingMoments ? 'animate-spin' : ''}`}><i className="fas fa-sync-alt text-sm"></i></button>
                        <button onClick={() => setIsPostingMoment(true)} className="w-8 h-8 bg-black/20 backdrop-blur-md rounded-full text-white flex items-center justify-center hover:bg-black/40 transition"><i className="fas fa-camera text-sm"></i></button>
                    </div>
                    
                    {/* List */}
                    <div className="px-4 space-y-8 min-h-[50vh]">
                        {moments.length === 0 && <div className="text-center text-stone-400 mt-10 font-bold opacity-60">暂无朋友圈，点击右上角相机发布！</div>}
                        
                        {moments.map(moment => (
                            <div key={moment.id} className="flex gap-3 animate-fade-in group pb-4 border-b border-stone-100 last:border-0">
                                <img src={moment.avatar} className="w-10 h-10 rounded-lg bg-stone-200 object-cover mt-1 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-stone-800 text-[15px] mb-1 leading-tight">{moment.name}</div>
                                    {moment.content && <div className="text-[15px] text-stone-800 leading-relaxed mb-2 whitespace-pre-wrap">{moment.content}</div>}
                                    
                                    {moment.images && (
                                        <div className={`grid gap-1 mb-2 ${moment.images.length === 1 ? 'grid-cols-1 max-w-[200px]' : 'grid-cols-3 max-w-[280px]'} rounded-lg overflow-hidden`}>
                                            {moment.images.map((img, i) => (
                                                isImageContent(img) ? (
                                                    // Real Image
                                                    <img key={i} src={img} onClick={(e) => { e.stopPropagation(); setViewingPhotoUrl(img); }} className={`w-full h-full ${moment.images && moment.images.length === 1 ? 'max-h-[300px]' : 'aspect-square'} object-cover bg-stone-100 hover:opacity-90 cursor-pointer`} />
                                                ) : (
                                                    // Imagined Photo (Text as Image)
                                                    <div key={i} onClick={(e) => { e.stopPropagation(); setViewingPhotoDesc(img); }} className="w-full aspect-square bg-gray-100 flex flex-col items-center justify-center cursor-pointer border border-gray-200 hover:bg-gray-200 transition group/card relative overflow-hidden">
                                                        <div className="absolute inset-0 bg-stone-300 opacity-10"></div>
                                                        <i className="fas fa-image text-gray-400 mb-1 text-2xl"></i>
                                                        <span className="text-[10px] text-gray-500 font-serif tracking-widest px-2 truncate w-full text-center">意象照片</span>
                                                    </div>
                                                )
                                            ))}
                                        </div>
                                    )}

                                    <div className="flex justify-between items-center mt-2 relative">
                                        <span className="text-xs text-stone-400">{new Date(moment.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                        
                                        <div className="relative">
                                            <button 
                                                onClick={(e) => { 
                                                    e.stopPropagation(); 
                                                    setActiveInteractionId(activeInteractionId === moment.id ? null : moment.id); 
                                                }} 
                                                className="w-8 h-5 bg-stone-100 rounded text-stone-600 flex items-center justify-center hover:bg-stone-200 transition active:scale-90"
                                            >
                                                <div className="flex gap-[2px]">
                                                    <div className="w-1 h-1 bg-stone-600 rounded-full"></div>
                                                    <div className="w-1 h-1 bg-stone-600 rounded-full"></div>
                                                </div>
                                            </button>

                                            <div className={`absolute right-10 top-1/2 -translate-y-1/2 flex bg-stone-800 rounded-lg overflow-hidden transition-all duration-200 shadow-lg ${activeInteractionId === moment.id ? 'w-40 opacity-100' : 'w-0 opacity-0 pointer-events-none'}`} style={{zIndex: 50}}>
                                                <button onClick={(e) => { e.stopPropagation(); handleLikeMoment(moment); }} className="flex-1 flex items-center justify-center gap-2 py-2 text-white hover:bg-stone-700 text-xs font-bold whitespace-nowrap">
                                                    <i className={`far fa-heart ${moment.likes.includes('USER') ? 'text-red-500 font-bold' : ''}`}></i> {moment.likes.includes('USER') ? '取消' : '赞'}
                                                </button>
                                                <div className="w-[1px] bg-stone-700 my-2"></div>
                                                <button onClick={(e) => { e.stopPropagation(); setCommentInput({momentId: moment.id, isUserMoment: !!moment.isUser}); setActiveInteractionId(null); }} className="flex-1 flex items-center justify-center gap-2 py-2 text-white hover:bg-stone-700 text-xs font-bold whitespace-nowrap">
                                                    <i className="far fa-comment"></i> 评论
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {(moment.likes.length > 0 || moment.comments.length > 0) && (
                                        <div className="bg-stone-100/70 rounded-[4px] mt-3 text-[13px] relative">
                                            <div className="absolute -top-1.5 left-4 w-3 h-3 bg-stone-100/70 rotate-45"></div>
                                            
                                            {moment.likes.length > 0 && (
                                                <div className={`p-2 px-3 text-stone-600 font-bold flex items-center flex-wrap gap-1 leading-normal ${moment.comments.length > 0 ? 'border-b border-stone-200/50' : ''}`}>
                                                    <i className="far fa-heart text-xs text-stone-500 mt-[2px] mr-1"></i>
                                                    {moment.likes.includes('USER') ? '我' : ''}
                                                    {moment.likes.filter(l => l !== 'USER').length > 0 && (moment.likes.includes('USER') ? ', ' : '') + moment.likes.filter(l => l !== 'USER').length + '人'}
                                                </div>
                                            )}

                                            {moment.comments.length > 0 && (
                                                <div className="p-2 px-3 space-y-1">
                                                    {moment.comments.map(c => (
                                                        <div key={c.id} className="leading-snug">
                                                            <span className="text-stone-800 font-bold cursor-pointer hover:bg-stone-200/50 rounded px-0.5 -ml-0.5">{c.authorName}</span>
                                                            <span className="text-stone-600">: {c.content}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* --- POST MOMENT MODAL --- */}
                {isPostingMoment && (
                    <div className="absolute inset-0 bg-white z-50 animate-slide-up flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-4 flex justify-between items-center border-b bg-gray-50/50 backdrop-blur">
                            <button onClick={() => setIsPostingMoment(false)} className="text-stone-600 font-bold">取消</button>
                            <button onClick={handlePostMoment} className={`px-4 py-1.5 rounded-lg bg-[#07c160] text-white font-bold shadow-sm active:opacity-80 ${(!newMomentContent && newMomentImages.length === 0) ? 'opacity-50' : ''}`}>发表</button>
                        </div>
                        <div className="p-6 flex-1 overflow-y-auto">
                            <textarea value={newMomentContent} onChange={e => setNewMomentContent(e.target.value)} className="w-full h-32 resize-none outline-none text-base placeholder-stone-300 mb-4" placeholder="这一刻的想法..."/>
                            
                            {/* Image Previews */}
                            <div className="flex flex-wrap gap-2 mb-6">
                                {newMomentImages.map((img, idx) => (
                                    <div key={idx} className="w-24 h-24 relative rounded-lg overflow-hidden border border-gray-200 group">
                                        {isImageContent(img) ? (
                                            <img src={img} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full bg-stone-100 flex flex-col items-center justify-center p-2 text-center relative">
                                                <i className="fas fa-font text-stone-400 mb-1"></i>
                                                <span className="text-[8px] text-stone-500 font-serif leading-tight line-clamp-3">{img}</span>
                                            </div>
                                        )}
                                        <button onClick={() => setNewMomentImages(prev => prev.filter((_, i) => i !== idx))} className="absolute top-1 right-1 bg-black/50 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"><i className="fas fa-times"></i></button>
                                    </div>
                                ))}
                                {newMomentImages.length < 9 && (
                                    <div className="flex flex-col gap-2">
                                        <label className="w-24 h-24 bg-gray-50 rounded-lg flex flex-col items-center justify-center text-gray-400 cursor-pointer hover:bg-gray-100 border border-dashed border-gray-300">
                                            <i className="fas fa-camera text-xl mb-1"></i>
                                            <span className="text-[10px]">照片</span>
                                            <input type="file" accept="image/*" onChange={handleAddMomentImage} className="hidden" />
                                        </label>
                                        <button onClick={handleAddMomentImagined} className="w-24 h-8 bg-gray-50 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 border border-gray-200 text-xs font-bold gap-1">
                                            <i className="fas fa-magic"></i> 意象
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="border-t py-4 flex items-center justify-between cursor-pointer active:bg-gray-50 -mx-4 px-4" onClick={() => setShowVisibilitySelector(!showVisibilitySelector)}>
                                <div className="flex items-center gap-3 text-stone-800 font-bold"><i className="fas fa-user-friends text-stone-500 w-5"></i> 谁可以看</div>
                                <div className="flex items-center gap-2 text-stone-400 text-sm font-bold">{momentVisibility.length === 0 ? '公开' : `部分可见(${momentVisibility.length})`} <i className="fas fa-chevron-right"></i></div>
                            </div>
                            
                            {showVisibilitySelector && (
                                <div className="bg-stone-50 p-2 rounded-xl mt-2 max-h-40 overflow-y-auto border border-stone-100 shadow-inner">
                                    {characters.map(c => (
                                        <div key={c.id} className="flex items-center gap-3 p-3 border-b border-stone-100 last:border-0 hover:bg-white rounded-lg transition cursor-pointer" onClick={() => { if (momentVisibility.includes(c.id)) setMomentVisibility(momentVisibility.filter(id => id !== c.id)); else setMomentVisibility([...momentVisibility, c.id]); }}>
                                            <input type="checkbox" checked={momentVisibility.includes(c.id)} onChange={()=>{}} className="w-5 h-5 accent-green-500 pointer-events-none"/>
                                            <img src={c.avatar} className="w-8 h-8 rounded-full object-cover" />
                                            <span className="text-sm font-bold text-stone-700">{c.remark}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* --- ADD IMAGINED PHOTO MODAL (New) --- */}
                {showImaginedInput && (
                    <div className="absolute inset-0 z-[60] bg-black/50 flex items-center justify-center p-6 animate-fade-in" onClick={() => setShowImaginedInput(false)}>
                        <div className="bg-white w-full rounded-2xl p-6 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
                            <h3 className="font-bold text-lg mb-4 text-stone-800">添加意象照片</h3>
                            <p className="text-xs text-stone-400 mb-4">描述你脑海中的画面，它将以“意象卡片”的形式展示。</p>
                            <textarea 
                                autoFocus
                                className="w-full bg-stone-50 p-3 rounded-xl border border-stone-200 h-32 resize-none focus:outline-none focus:border-stone-400 mb-4 text-sm"
                                placeholder="例如：午后的阳光洒在书桌上，一杯咖啡冒着热气..."
                                value={tempImaginedText}
                                onChange={e => setTempImaginedText(e.target.value)}
                            />
                            <div className="flex gap-3">
                                <button onClick={() => setShowImaginedInput(false)} className="flex-1 py-3 bg-gray-100 text-gray-500 font-bold rounded-xl">取消</button>
                                <button onClick={confirmImaginedImage} className="flex-1 py-3 bg-stone-900 text-white font-bold rounded-xl">确定添加</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- COMMENT INPUT MODAL (Fixed Bottom) --- */}
                {commentInput && (
                    <div className="absolute inset-0 z-[60] flex flex-col justify-end" onClick={() => setCommentInput(null)}>
                        <div className="bg-[#f7f7f7] p-3 flex gap-2 items-center animate-slide-up border-t border-gray-300 pb-6 sm:pb-3 shadow-[0_-4px_20px_rgba(0,0,0,0.1)]" onClick={e => e.stopPropagation()}>
                            <input 
                                autoFocus 
                                className="flex-1 bg-white rounded-[4px] px-3 py-2 text-sm focus:outline-none border border-gray-200" 
                                placeholder="评论..." 
                                value={commentText} 
                                onChange={e => setCommentText(e.target.value)}
                                onKeyDown={e => { if(e.key === 'Enter') submitComment(); }}
                            />
                            <button onClick={submitComment} className={`bg-[#07c160] text-white px-3 py-1.5 rounded-[4px] text-sm font-bold transition ${!commentText.trim() ? 'opacity-50' : 'active:opacity-80'}`} disabled={!commentText.trim()}>发送</button>
                        </div>
                    </div>
                )}

                {/* --- PHOTO DESCRIPTION MODAL --- */}
                {viewingPhotoDesc && (
                    <div className="absolute inset-0 z-[70] bg-black/60 flex items-center justify-center p-8 animate-fade-in" onClick={() => setViewingPhotoDesc(null)}>
                        <div className="bg-white w-full max-w-sm rounded-lg p-8 shadow-2xl relative animate-slide-up flex flex-col items-center text-center" onClick={e => e.stopPropagation()}>
                            <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-6 text-stone-400 text-2xl shadow-inner">
                                <i className="fas fa-quote-left"></i>
                            </div>
                            <div className="font-serif text-lg leading-relaxed text-stone-800 whitespace-pre-wrap italic">
                                “ {viewingPhotoDesc} ”
                            </div>
                            <div className="mt-8 pt-6 border-t w-full border-gray-100">
                                <button onClick={() => setViewingPhotoDesc(null)} className="text-xs text-stone-400 font-sans tracking-[0.2em] hover:text-stone-600 transition">CLOSE</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- REAL PHOTO VIEWER --- */}
                {viewingPhotoUrl && (
                    <div className="absolute inset-0 z-[70] bg-black flex items-center justify-center animate-fade-in" onClick={() => setViewingPhotoUrl(null)}>
                        <img src={viewingPhotoUrl} className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()}/>
                        <button className="absolute top-4 right-4 text-white/80 hover:text-white text-3xl drop-shadow-md transition"><i className="fas fa-times"></i></button>
                    </div>
                )}
            </div>
        );
    }

    if (activeTab === WeChatTab.ME) {
        return (
            <div className="p-6 bg-gray-50/50 h-full overflow-y-auto no-scrollbar">
                <div className="bg-white p-8 rounded-3xl shadow-sm space-y-8 border border-white/50 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-stone-800 to-black"></div>
                    <div className="flex items-center justify-between border-b border-stone-100 pb-4">
                        <h2 className="font-bold text-2xl text-stone-800 tracking-tight">全局人设</h2>
                        {isSavingPersona && <span className="text-[#07c160] text-sm font-bold animate-fade-in flex items-center gap-1 bg-green-50 px-2 py-1 rounded-full"><i className="fas fa-check-circle"></i> 已保存</span>}
                    </div>
                    
                    <div className="flex flex-col items-center">
                        <div className="relative w-28 h-28 group">
                            <img src={tempGlobalPersona.avatar} className="w-full h-full rounded-full object-cover shadow-xl border-[6px] border-stone-50 group-hover:border-white transition-all" />
                            <div className="absolute inset-0 bg-black/30 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer backdrop-blur-[2px]">
                                <i className="fas fa-camera text-white text-2xl"></i>
                            </div>
                            <input type="file" accept="image/*" onChange={handleGlobalAvatarUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                        </div>
                        <p className="text-xs font-bold text-stone-400 mt-3 uppercase tracking-wider">点击更换头像</p>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-stone-400 mb-2 uppercase tracking-widest ml-1">我的名字</label>
                            <input value={tempGlobalPersona.name} onChange={(e) => setTempGlobalPersona({...tempGlobalPersona, name: e.target.value})} className="w-full p-4 bg-stone-50 rounded-xl border border-stone-200 focus:outline-none focus:border-stone-400 focus:bg-white focus:ring-4 focus:ring-stone-100 transition font-bold text-stone-800" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-stone-400 mb-2 uppercase tracking-widest ml-1">人设/简介</label>
                            <textarea value={tempGlobalPersona.description} onChange={(e) => setTempGlobalPersona({...tempGlobalPersona, description: e.target.value})} className="w-full p-4 bg-stone-50 rounded-xl border border-stone-200 focus:outline-none focus:border-stone-400 focus:bg-white focus:ring-4 focus:ring-stone-100 transition h-32 resize-none text-sm leading-relaxed text-stone-600" placeholder="AI 将根据这个描述来认识你..." />
                        </div>
                    </div>
                    
                    <button onClick={saveGlobalPersona} className="w-full py-4 bg-stone-900 hover:shadow-lg text-white font-bold rounded-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-lg">
                        <i className="fas fa-save"></i> 保存设置
                    </button>
                </div>
            </div>
        )
    }

    return null;
  };

  return (
    <div className="h-full bg-gradient-to-b from-gray-50 to-gray-100 flex flex-col text-black relative">
      {/* HEADER */}
      <div className="bg-white/70 backdrop-blur-md px-4 py-3 flex justify-between items-end pb-3 sticky top-0 z-10 border-b border-gray-200/50 shadow-sm transition-all">
         <div className="flex items-center gap-3">
             <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-200/80 transition active:scale-90"><i className="fas fa-arrow-left text-gray-700"></i></button>
             <h1 className="font-bold text-xl ml-1 text-gray-800 tracking-tight">
                 {activeTab === WeChatTab.CHATS && (isCreating ? '创建角色' : '消息')}
                 {activeTab === WeChatTab.CONTACTS && '通讯录'}
                 {activeTab === WeChatTab.MOMENTS && '朋友圈'}
                 {activeTab === WeChatTab.ME && '我'}
             </h1>
             {activeTab === WeChatTab.CHATS && !isCreating && <span className="bg-gray-200 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-bold">{characters.length}</span>}
         </div>
         <div className="flex gap-4 mr-1">
             <button className="w-8 h-8 rounded-full hover:bg-gray-200/50 flex items-center justify-center transition"><i className="fas fa-search text-gray-700"></i></button>
             <button onClick={() => {setActiveTab(WeChatTab.CONTACTS); setIsCreating(true)}} className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center shadow-md hover:scale-110 transition active:scale-95"><i className="fas fa-plus"></i></button>
         </div>
      </div>
      
      {/* CONTENT */}
      <div className="flex-1 overflow-hidden relative flex flex-col">{renderContent()}</div>
      
      {/* BOTTOM TAB BAR */}
      <div className="bg-white/90 backdrop-blur-xl border-t border-gray-200 flex justify-around py-2 pb-6 sm:pb-3 z-10 relative shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
         {[{id: WeChatTab.CHATS, icon: 'comment', label: '微信'}, {id: WeChatTab.CONTACTS, icon: 'address-book', label: '通讯录'}, {id: WeChatTab.MOMENTS, icon: 'compass', label: '发现'}, {id: WeChatTab.ME, icon: 'user', label: '我'}].map(tab => (
           <button key={tab.id} onClick={() => {setActiveTab(tab.id as WeChatTab); setIsCreating(false); if(tab.id === WeChatTab.MOMENTS) setHasNewMoment(false);}} className={`relative flex flex-col items-center gap-1 transition-all duration-300 w-16 group ${activeTab === tab.id ? 'text-red-900' : 'text-gray-400 hover:text-gray-600'}`}>
               <div className={`text-xl transition-transform duration-300 ${activeTab === tab.id ? '-translate-y-1 scale-110 drop-shadow-sm' : 'group-hover:-translate-y-0.5'}`}>
                   <i className={`fas fa-${tab.icon}`}></i>
               </div>
               {tab.id === WeChatTab.MOMENTS && hasNewMoment && <div className="absolute top-0 right-3 w-2.5 h-2.5 bg-red-600 rounded-full border border-white animate-pulse"></div>}
               <span className={`text-[10px] font-bold ${activeTab === tab.id ? 'opacity-100' : 'opacity-0 scale-0'} transition-all duration-300 absolute -bottom-1`}>{tab.label}</span>
           </button>
         ))}
      </div>
      
      <NotificationBubble />
      
      {/* CONTEXT MENU */}
      {contextMenuCharId && (
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] z-50 flex flex-col justify-end" onClick={() => setContextMenuCharId(null)}>
            <div className="bg-white rounded-t-3xl p-6 animate-slide-up space-y-3 shadow-2xl pb-10" onClick={e => e.stopPropagation()}>
                <div className="w-12 h-1 bg-gray-200 rounded-full mx-auto mb-4"></div>
                <div className="text-center text-sm font-bold text-gray-500 mb-4">管理 {characters.find(c => c.id === contextMenuCharId)?.remark}</div>
                <button onClick={handleTogglePin} className="w-full py-4 bg-stone-100 rounded-2xl font-bold text-stone-900 flex items-center justify-center gap-3 active:scale-[0.98] transition"><i className="fas fa-thumbtack"></i>{characters.find(c => c.id === contextMenuCharId)?.isPinned ? '取消置顶' : '置顶聊天'}</button>
                
                {/* SAFE DELETE BUTTON UI */}
                {isDeleteConfirming ? (
                    <button onClick={(e) => { e.stopPropagation(); executeDeleteChar(); }} className="w-full py-4 bg-red-600 text-white rounded-2xl font-bold flex items-center justify-center gap-3 active:scale-[0.98] transition shadow-lg shadow-red-200 animate-pulse">
                        <i className="fas fa-exclamation-triangle"></i> 确认彻底删除 (无法恢复)
                    </button>
                ) : (
                    <button onClick={(e) => { e.stopPropagation(); setIsDeleteConfirming(true); }} className="w-full py-4 bg-red-50 rounded-2xl font-bold text-red-900 flex items-center justify-center gap-3 active:scale-[0.98] transition">
                        <i className="fas fa-trash"></i> 删除该联系人
                    </button>
                )}

                <button onClick={() => setContextMenuCharId(null)} className="w-full py-4 mt-2 bg-white border border-gray-200 rounded-2xl font-bold text-gray-500 active:bg-gray-50 transition">取消</button>
            </div>
        </div>
      )}
    </div>
  );
};

export default WeChatApp;