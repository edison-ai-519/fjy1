import * as React from 'react';
import { MessageSquarePlus, Loader2, MessageSquareText, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
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
  const [pendingDeleteSession, setPendingDeleteSession] = React.useState<ConversationSession | null>(null);

  const filteredSessions = React.useMemo(
    () => filterAssistantSessions(sessions, ''),
    [sessions],
  );

  const handleConfirmDelete = React.useCallback(() => {
    if (!pendingDeleteSession) {
      return;
    }
    onDeleteSession(pendingDeleteSession.id);
    setPendingDeleteSession(null);
  }, [onDeleteSession, pendingDeleteSession]);

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="h-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full space-y-4 p-4 pr-6">
            <Button
              type="button"
              onClick={onNewSession}
              disabled={isBusy}
              className="h-11 w-full justify-start gap-2 rounded-2xl bg-background border border-border text-foreground hover:bg-muted/50 hover:border-border/80 shadow-sm transition-all"
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
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                    <MessageSquareText className="mb-3 h-5 w-5 text-slate-300" />
                    <p>没有匹配的对话</p>
                  </div>
                ) : (
                  filteredSessions.map((session) => {
                    const isActive = session.id === activeSessionId;

                    return (
                      <div
                        key={session.id}
                        className={cn(
                          'relative rounded-xl border pl-2 pr-11 py-2 transition-all duration-200',
                          isActive
                            ? 'border-primary/50 bg-primary/5 shadow-[0_0_0_1px_rgba(76,141,255,0.2)]'
                            : 'border-border/40 bg-card hover:border-border/80 hover:shadow-sm',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectSession(session.id)}
                          disabled={isBusy && !isActive}
                          className="block min-w-0 w-full rounded-lg px-2 py-1.5 text-left"
                        >
                          <div className="min-w-0">
                            <div className={cn(
                              'truncate text-[13px] font-bold',
                              isActive ? 'text-primary' : 'text-foreground/90',
                            )}>
                              {session.title}
                            </div>
                          </div>
                        </button>
                        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
                          {session.loading ? (
                            <Loader2 className={cn('h-4 w-4 animate-spin', isActive ? 'text-primary' : 'text-muted-foreground')} />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setPendingDeleteSession(session)}
                              disabled={isBusy}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                              title="删除会话"
                              aria-label={`删除会话：${session.title}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <AlertDialog
        open={Boolean(pendingDeleteSession)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteSession(null);
          }
        }}
      >
        <AlertDialogContent className="rounded-3xl border-slate-200 shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这个会话吗？</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteSession
                ? `删除后将无法恢复：“${pendingDeleteSession.title}”。`
                : '删除后将无法恢复。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="rounded-2xl bg-red-600 hover:bg-red-700"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
