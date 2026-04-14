import * as React from 'react';
import { MessageSquarePlus, Loader2, MessageSquareText, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import { filterAssistantSessions } from './history';
import type { ConversationSession } from './types';

interface SidebarProps {
  sessions: ConversationSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  isBusy: boolean;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  isBusy,
}: SidebarProps) {
  const filteredSessions = React.useMemo(
    () => filterAssistantSessions(sessions, ''),
    [sessions],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border bg-card shadow-sm">
      <ScrollArea className="flex-1 min-h-0 h-0">
        <div className="p-4 space-y-4">
          <Button
            type="button"
            onClick={onNewSession}
            disabled={isBusy}
            className="h-11 w-full justify-start gap-2 rounded-2xl bg-white border border-slate-200 text-slate-900 hover:bg-slate-50 hover:border-slate-300 shadow-sm transition-all"
          >
            <MessageSquarePlus className="h-4 w-4 text-blue-600" />
            新对话
          </Button>

          <div className="pt-2">
            <div className="flex items-center justify-between py-1 text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] px-1 mb-2">
              <span>最近对话</span>
              <span className="opacity-50 tracking-normal">共 {filteredSessions.length} 条</span>
            </div>
            <div className="space-y-2">
              {filteredSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  <MessageSquareText className="mb-3 h-5 w-5 text-slate-300" />
                  <p>没有匹配的对话</p>
                </div>
              ) : (
                filteredSessions.map((session) => {
                  const isActive = session.id === activeSessionId;

                  return (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => onSelectSession(session.id)}
                      disabled={isBusy && !isActive}
                      className={cn(
                        'group w-full rounded-xl border px-3 py-3 text-left transition-all duration-200',
                        isActive
                          ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500/20'
                          : 'border-slate-100 bg-white hover:border-slate-300 hover:shadow-sm',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className={cn(
                            "truncate text-[13px] font-bold",
                            isActive ? "text-blue-700" : "text-slate-800"
                          )}>
                            {session.title}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center">
                          {session.loading ? (
                            <Loader2 className={cn('mt-0.5 h-4 w-4 animate-spin', isActive ? 'text-slate-200' : 'text-blue-500')} />
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteSession(session.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-50 hover:text-red-500 transition-all text-slate-400"
                              title="删除会话"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
