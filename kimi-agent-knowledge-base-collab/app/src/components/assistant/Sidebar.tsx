import * as React from 'react';
import { MessageSquarePlus, Loader2, MessageSquareText, Trash2, ListChecks, X } from 'lucide-react';

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
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

import { filterAssistantSessions } from './history';
import type { ConversationSession } from './types';

interface SidebarProps {
  sessions: ConversationSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onDeleteSessions: (ids: string[]) => void;
  isBusy: boolean;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onDeleteSessions,
  isBusy,
}: SidebarProps) {
  const [pendingDeleteSession, setPendingDeleteSession] = React.useState<ConversationSession | null>(null);
  const [isBatchMode, setIsBatchMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [showBatchDeleteAlert, setShowBatchDeleteAlert] = React.useState(false);

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

  const handleBatchDelete = React.useCallback(() => {
    if (selectedIds.size === 0) return;
    onDeleteSessions(Array.from(selectedIds));
    setSelectedIds(new Set());
    setIsBatchMode(false);
    setShowBatchDeleteAlert(false);
  }, [onDeleteSessions, selectedIds]);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredSessions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSessions.map((s) => s.id)));
    }
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border bg-card shadow-sm">
        <div className="h-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="w-full space-y-4 p-4 pr-6">
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={onNewSession}
                disabled={isBusy || isBatchMode}
                className="h-11 flex-1 justify-start gap-2 rounded-2xl bg-background border border-border text-foreground hover:bg-muted/50 hover:border-border/80 shadow-sm transition-all"
              >
                <MessageSquarePlus className="h-4 w-4 text-blue-600" />
                新对话
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  setIsBatchMode(!isBatchMode);
                  setSelectedIds(new Set());
                }}
                className={cn(
                  "h-11 w-11 rounded-2xl transition-all",
                  isBatchMode ? "bg-primary/10 border-primary text-primary" : "bg-background"
                )}
                title={isBatchMode ? "退出管理" : "批量管理"}
              >
                {isBatchMode ? <X className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
              </Button>
            </div>

            {isBatchMode && (
              <div className="flex items-center justify-between px-1 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="flex items-center gap-2">
                  <Checkbox 
                    id="select-all" 
                    checked={selectedIds.size === filteredSessions.length && filteredSessions.length > 0}
                    onCheckedChange={toggleSelectAll}
                    className="rounded-md"
                  />
                  <label htmlFor="select-all" className="text-[10px] font-bold text-slate-500 uppercase tracking-widest cursor-pointer select-none">
                    全选 ({selectedIds.size})
                  </label>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={selectedIds.size === 0}
                  onClick={() => setShowBatchDeleteAlert(true)}
                  className="h-7 text-[10px] font-black uppercase tracking-widest text-red-500 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="mr-1.5 h-3 w-3" />
                  删除选中
                </Button>
              </div>
            )}

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
                    const isSelected = selectedIds.has(session.id);

                    return (
                      <div
                        key={session.id}
                        className={cn(
                          'relative rounded-xl border transition-all duration-200',
                          isBatchMode ? 'pl-10' : 'pl-2',
                          'pr-11 py-2',
                          isActive && !isBatchMode
                            ? 'border-primary/50 bg-primary/5 shadow-[0_0_0_1px_rgba(76,141,255,0.2)]'
                            : isSelected 
                              ? 'border-primary/30 bg-primary/5' 
                              : 'border-border/40 bg-card hover:border-border/80 hover:shadow-sm',
                        )}
                      >
                        {isBatchMode && (
                          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center">
                            <Checkbox 
                              checked={isSelected}
                              onCheckedChange={() => toggleSelection(session.id)}
                              className="rounded-md border-border/60 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => isBatchMode ? toggleSelection(session.id) : onSelectSession(session.id)}
                          disabled={isBusy && !isActive}
                          className="block min-w-0 w-full rounded-lg px-2 py-1.5 text-left"
                        >
                          <div className="min-w-0">
                            <div className={cn(
                              'truncate text-[13px] font-bold',
                              isActive && !isBatchMode ? 'text-primary' : 'text-foreground/90',
                            )}>
                              {session.title}
                            </div>
                          </div>
                        </button>
                        {!isBatchMode && (
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
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Single Delete Dialog */}
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

      {/* Batch Delete Dialog */}
      <AlertDialog
        open={showBatchDeleteAlert}
        onOpenChange={setShowBatchDeleteAlert}
      >
        <AlertDialogContent className="rounded-3xl border-slate-200 shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量删除选中会话吗？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除选中的 {selectedIds.size} 个会话吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBatchDelete}
              className="rounded-2xl bg-red-600 hover:bg-red-700 text-white"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
