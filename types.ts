

export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  osContent?: string;
  timestamp: number;
  mode?: 'online' | 'offline' | 'theater';
  scenarioId?: string;
  isRecalled?: boolean;
  originalContent?: string;
  quote?: { id: string; content: string; name: string; };
  isHidden?: boolean;
  // New fields for rich media types
  msgType?: 'text' | 'voice' | 'image' | 'transfer' | 'location' | 'video_call' | 'gossip' | 'nudge';
  meta?: any; // Stores duration, amount, url, etc.
}

export interface MemoryCard {
  id: string;
  location?: string;
  event: string;
  status?: string;
  content: string;
  timestamp: number;
  selected?: boolean;
}

export interface DiaryEntry {
  id: string;
  timestamp: number;
  title: string;
  weather: string;
  mood: string;
  content: string;
  isExpanded?: boolean;
}

export interface PeekReaction {
  charId: string;
  charName: string;
  charAvatar: string;
  comment: string;
  timestamp: number;
}

export interface UserDiaryEntry {
  id: string;
  timestamp: number;
  title: string;
  content: string;
  weather: string;
  mood: string;
  peeks: PeekReaction[];
  isExpanded?: boolean;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  isAi?: boolean;
}

export interface Moment {
  id: string;
  authorId: string;
  content: string;
  images?: string[];
  timestamp: number;
  likes: string[];
  comments: Comment[];
  visibleTo?: string[];
}

export interface FurnaceConfig {
  autoEnabled: boolean;
  autoThreshold: number;
  autoScope: number;
  manualScope: number;
}

export interface OfflineConfig {
  systemPrompt: string;
  style: string;
  wordCount: number;
  bgUrl?: string;
  indicatorColor?: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  systemPrompt: string;
  isConnected: boolean;
  wallpaper?: string;
  contextMemory?: string;
  messages?: Message[];
}

export interface StyleConfig {
  onlineUser: string;
  onlineModel: string;
  offlineUser: string;
  offlineModel: string;
}

export interface GlobalPersona {
  name: string;
  avatar: string;
  description: string;
  diaries: UserDiaryEntry[];
  moments: Moment[];
}

export interface Character {
  id: string;
  name: string;
  remark: string;
  avatar: string;
  description: string;
  personality: string;
  systemPrompt: string;
  osSystemPrompt?: string;
  showOS?: boolean;
  useLocalPersona: boolean;
  userMaskName: string;
  userMaskAvatar?: string;
  userMaskDescription?: string;
  realTimeMode: boolean;
  chatBackground?: string;
  chatFontSize?: number; 
  styleConfig?: StyleConfig;
  contextMemory: string;
  historyCount: number;
  furnaceConfig: FurnaceConfig;
  offlineConfig: OfflineConfig;
  scenarios?: Scenario[];
  memories: MemoryCard[];
  messages: Message[];
  diaries: DiaryEntry[];
  diaryStyle?: string; 
  moments: Moment[]; 
  autoPostMoments: boolean; 
  isPinned?: boolean;
  unread?: number;
  renderMessageLimit?: number; // New field for lazy loading
}

export interface Widget {
  id: string;
  image: string;
}

export interface PolaroidConfig {
    image: string;
    text: string;
}

export interface HomeConfig {
    banner: string;
    albumImages: string[]; // Expect 3 images
    statusText: string;
    signature: string;
    polaroid: PolaroidConfig;
}

export interface AppSettings {
  apiUrl: string;
  apiKey: string;
  model: string;
  wallpaper: string;
  fullScreenMode: boolean;
  customFont?: string;
  immersiveFontSize?: number;
  widgets?: Widget[];
  homeConfig?: HomeConfig;
  availableModels: string[];
  globalPersona: GlobalPersona;
}

export interface BackupData {
  version: number;
  type?: 'small_phone_backup';
  timestamp: number;
  settings: AppSettings;
  characters: Character[];
}

export enum AppRoute {
  HOME = 'HOME',
  WECHAT = 'WECHAT',
  SETTINGS = 'SETTINGS',
  DIARY = 'DIARY',
}

export enum WeChatTab {
  CHATS = 'CHATS',
  CONTACTS = 'CONTACTS',
  MOMENTS = 'MOMENTS',
  ME = 'ME',
}