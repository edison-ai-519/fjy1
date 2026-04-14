import React, { useRef, useEffect } from 'react';
import { Send, User, Bot, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { AssistantMarkdown } from './AssistantMarkdown';

interface ChatAreaProps {
  activeSession: any;
  onAsk: (question?: string) => void;
  onDraftChange: (value: string) => void;
  isBusy: boolean;
  selectedEntityName?: string;
  renderSettings?: () => React.ReactNode;
}

export function ChatArea({ activeSession, onAsk, onDraftChange, isBusy, selectedEntityName, renderSettings }: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { messages, draftQuestion, loading, error, statusMessage } = activeSession;

  // Auto-scroll logic
  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, loading, statusMessage]);

  // Auto-resize logic
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      // Calculate max height for 8 lines (roughly 44px base + 7 * 21px = 191px)
      const newHeight = Math.min(textarea.scrollHeight, 192);
      textarea.style.height = `${newHeight}px`;
    }
  }, [draftQuestion]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isBusy) {
      e.preventDefault();
      onAsk();
    }
  };

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex flex-col">
          <h3 className="text-xs font-bold truncate max-w-[300px] text-slate-800">
            {activeSession.title || '对话'}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] text-muted-foreground uppercase tracking-widest font-black">Context:</span>
            <Badge variant="secondary" className="px-1 py-0 text-[9px] h-3.5 bg-blue-50 text-blue-600 border-none font-bold">
              {selectedEntityName || 'None'}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {renderSettings?.()}
        </div>
      </div>

      <ScrollArea ref={scrollRef} className="flex-1 min-h-0">
        <div className="w-full py-3 px-6 space-y-3">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900">随时提问</h4>
                <p className="text-[11px] text-muted-foreground max-w-[240px]">
                  直接提问或选择侧边栏实体获得针对性解答
                </p>
              </div>
            </div>
          )}

          {messages.map((message: any) => (
            <div key={message.id} className="space-y-3">
              {/* User Message */}
              <div className="flex gap-2.5 group">
                <div className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <User className="w-3 h-3 text-slate-500" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">You</div>
                  <div className="text-[13px] leading-relaxed text-slate-800 bg-slate-50/50 rounded-lg p-2.5 border border-transparent group-hover:border-slate-100 transition-colors">
                    {message.question}
                  </div>
                </div>
              </div>

              {/* Bot Message */}
              <div className="flex gap-2.5">
                <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 shadow-sm shadow-blue-200">
                  <Bot className="w-3 h-3 text-white" />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="text-[10px] font-black text-slate-900 flex items-center gap-1.5 uppercase tracking-widest">
                    XiaoGu Agent
                    {message.relatedNames?.length > 0 && (
                      <span className="text-[8px] font-medium text-slate-400 normal-case">
                        ({message.relatedNames.join(', ')})
                      </span>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
                    <AssistantMarkdown content={message.answer} />
                  </div>
                </div>
              </div>
            </div>
          ))}

          {loading && statusMessage && (
            <div className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 animate-pulse">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 py-1">
                <div className="text-sm font-bold text-slate-900">XiaoGu Agent</div>
                <div className="mt-2 flex items-center gap-2 text-sm text-slate-500 italic">
                  <span>{statusMessage}</span>
                  <span className="flex gap-1">
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1 h-1 bg-slate-400 rounded-full animate-bounce"></span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 p-4 rounded-xl border border-red-100 bg-red-50/50 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="shrink-0 border-t bg-white p-4">
        <div className="relative w-full px-6">
          <div className="relative flex items-end gap-2 bg-slate-50/50 rounded-3xl border border-slate-200 p-2 focus-within:bg-white focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-50/50 transition-all duration-300 shadow-sm">
            <Textarea
              ref={textareaRef}
              placeholder="发送消息..."
              value={draftQuestion}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 min-h-[44px] max-h-[192px] w-full px-4 py-3 rounded-2xl resize-none border-none bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-[13px] leading-relaxed placeholder:text-slate-400 textarea-bubbly"
            />
            <div className="pb-1.5 pr-1.5">
              <Button
                size="icon"
                onClick={() => onAsk()}
                disabled={loading || isBusy || !draftQuestion.trim()}
                className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-200 transition-all active:scale-90 disabled:opacity-30"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-center text-slate-400 font-medium">
            按 Enter 发送，Shift + Enter 换行
          </div>
        </div>
      </div>
    </div>
  );
}
