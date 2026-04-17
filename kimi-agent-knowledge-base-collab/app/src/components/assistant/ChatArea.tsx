import React, { useRef, useEffect } from 'react';
import { Sparkles, AlertCircle, Copy, Check, ArrowUp, ArrowDown, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { AssistantMarkdown, copyCodeToClipboard } from './AssistantMarkdown';
import { cn } from '@/lib/utils';

interface ChatAreaProps {
  activeSession: any;
  onAsk: (question?: string) => void;
  onStop: () => void;
  onDraftChange: (value: string) => void;
  isBusy: boolean;
  selectedEntityName?: string;
  renderSettings?: () => React.ReactNode;
  renderExtraActions?: () => React.ReactNode;
}

function MessageCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    await copyCodeToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "opacity-0 group-hover/msg:opacity-100 transition-all p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground",
        copied && "opacity-100 text-green-500"
      )}
      title={copied ? "已复制" : "复制"}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function ChatArea({
  activeSession,
  onAsk,
  onStop,
  onDraftChange,
  isBusy,
  renderSettings,
  renderExtraActions
}: ChatAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showScrollButton, setShowScrollButton] = React.useState(false);
  const { messages, draftQuestion, loading, error, statusMessage } = activeSession;
  const lastMessage = messages[messages.length - 1];

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Show button if we are more than one viewport away from bottom
      const isScrolledUp = scrollHeight - scrollTop - clientHeight > clientHeight;
      setShowScrollButton(isScrolledUp);
    }
  };

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  // Auto-scroll logic
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading, statusMessage]);

  // Auto-resize logic
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 200);
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
    <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground">
      {/* Floating Header for Settings/Flow Toggle */}
      <div className="absolute top-0 left-0 right-0 z-20 h-14 flex items-center justify-between px-6 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {renderSettings?.()}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          {renderExtraActions?.()}
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-smooth"
      >
        <div className="flex min-h-full flex-col justify-end">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4 my-auto">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground/90">有什么可以帮你的？</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  可以询问关于本体知识库中任何概念、定义或关系的问题
                </p>
              </div>
            </div>
          )}

          <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 pt-16 pb-[55vh]">
            {messages.map((message: any, index: number) => {
              const prevMessage = index > 0 ? messages[index - 1] : null;
              const nextMessage = index < messages.length - 1 ? messages[index + 1] : null;

              const isUserFollowUp = prevMessage && !prevMessage.answer;
              const hasConsecutiveUser = nextMessage && !message.answer;

              return (
                <React.Fragment key={message.id}>
                  {/* User Message */}
                  <div className={cn(
                    "group/msg flex flex-col items-end",
                    isUserFollowUp ? "mt-3" : (index === 0 ? "mt-0" : "mt-10")
                  )}>
                    <div className="bg-muted/50 dark:bg-muted/40 rounded-3xl px-5 py-3.5 text-[17px] leading-[1.6] text-foreground break-words [overflow-wrap:anywhere] max-w-[85%] border border-border/20 shadow-sm transition-colors">
                      {message.question}
                    </div>
                    {!hasConsecutiveUser && (
                      <div className="mt-1 px-1">
                        <MessageCopyButton content={message.question} />
                      </div>
                    )}
                  </div>

                  {/* Agent Message — Only show if there is an answer */}
                  {message.answer && (
                    <div className="group/msg flex flex-col items-start px-1 mt-8 transition-all">
                      <div className="flex-1 min-w-0 w-full text-foreground/90">
                        <AssistantMarkdown content={message.answer} />
                      </div>
                      {(!loading || index < messages.length - 1) && (
                        <div className="mt-1 animate-in fade-in duration-500">
                          <MessageCopyButton content={message.answer} />
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Status & Typing Indicator (GPT style pulsing dot) */}
            {loading && (statusMessage || (lastMessage && !lastMessage?.answer)) && (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 mt-6">
                <div className="flex items-center gap-2.5 px-1">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <div className="w-2 bg-foreground rounded-full h-2 animate-pulse" />
                  </div>
                  {statusMessage && (
                    <span className="text-sm font-medium text-muted-foreground">{statusMessage}</span>
                  )}
                </div>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10 text-red-600 dark:text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="break-words [overflow-wrap:anywhere] font-medium">{error}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 pointer-events-none">
        {/* Scroll to Bottom Button */}
        <div className="absolute bottom-[190px] left-1/2 -translate-x-1/2 z-30 flex justify-center pointer-events-auto">
          <Button
            size="icon"
            variant="outline"
            onClick={scrollToBottom}
            className={cn(
              "w-10 h-10 rounded-full bg-background/80 backdrop-blur-md border border-border shadow-xl transition-all duration-300 transform",
              showScrollButton ? "translate-y-0 opacity-100 scale-100" : "translate-y-4 opacity-0 scale-90"
            )}
          >
            <ArrowDown className="w-4 h-4 text-muted-foreground" />
          </Button>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background via-background/80 to-transparent z-10" />
        <div className="relative w-full max-w-3xl mx-auto px-4 sm:px-6 pb-6 pt-0 text-center z-20">
          <div className="relative flex flex-col bg-background/95 backdrop-blur-xl rounded-[28px] border border-border p-1.5 shadow-2xl pointer-events-auto transition-all">
            {/* Input Row */}
            <div className="flex-1 w-full px-2">
              <Textarea
                ref={textareaRef}
                placeholder="有问必答..."
                value={draftQuestion}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full min-h-[32px] max-h-[200px] px-2 pt-2.5 pb-1 resize-none border-none bg-transparent dark:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-[17px] leading-[1.6] text-foreground placeholder:text-muted-foreground/50 shadow-none outline-none"
              />
            </div>

            {/* Toolbar Row */}
            <div className="flex items-center justify-end px-1">
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  onClick={() => (loading ? onStop() : onAsk())}
                  disabled={(!loading && !draftQuestion.trim()) || isBusy && !loading}
                  className={cn(
                    "w-10 h-10 rounded-full transition-all active:scale-95 shadow-md",
                    loading
                      ? "bg-muted text-foreground hover:bg-muted/80"
                      : "bg-foreground hover:bg-foreground/90 text-background"
                  )}
                >
                  {loading ? <Square className="w-4 h-4 fill-slate-900" /> : <ArrowUp className="w-5 h-5" />}
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground/60 italic tracking-wider">
            ENTER 发送 · SHIFT+ENTER 换行
          </div>
        </div>
      </div>
    </div>
  );
}
