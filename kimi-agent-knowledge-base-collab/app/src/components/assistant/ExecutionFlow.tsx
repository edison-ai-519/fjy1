import React from 'react';
import { Terminal, Activity, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible";

interface ExecutionFlowProps {
  toolRuns: any[];
}

export function ExecutionFlow({ toolRuns }: ExecutionFlowProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-slate-50/30">
      <div className="flex shrink-0 items-center gap-2 border-b bg-white p-4">
        <Activity className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold tracking-tight">执行流 (Execution Flow)</h3>
        <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-mono">
          {toolRuns.length} Steps
        </span>
      </div>

      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-4 space-y-4">
          {toolRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center opacity-30">
              <Terminal className="w-8 h-8 mb-2" />
              <p className="text-xs">暂无执行任务</p>
            </div>
          ) : (
            <div className="relative pl-1 space-y-4">
              {/* Timeline Connector */}
              <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-slate-200" />

              {toolRuns.map((run, index) => (
                <StepItem key={run.callId || index} run={run} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StepItem({ run }: { run: any }) {
  const [isOpen, setIsOpen] = React.useState(false);

  const getStatusIcon = () => {
    switch (run.status) {
      case 'running': return <LoaderIcon />;
      case 'success': return <CheckCircle2 className="w-4 h-4 text-green-500 fill-white" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-500 fill-white" />;
      case 'cancelled':
      case 'rejected': return <Info className="w-4 h-4 text-amber-500 fill-white" />;
      default: return <Clock className="w-4 h-4 text-slate-400 fill-white" />;
    }
  };

  return (
    <div className="relative pl-7 group">
      {/* Node Dot */}
      <div className="absolute left-1.5 top-1 z-10 -translate-x-1/2 bg-slate-50 p-0.5 rounded-full">
        {getStatusIcon()}
      </div>

      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
        <div
          className={cn(
            "p-3 rounded-xl border bg-white shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden relative",
            run.status === 'error' ? 'border-red-100' : 'border-slate-100',
            isOpen ? 'ring-2 ring-blue-500/10' : ''
          )}
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-wider px-1.5 rounded",
                run.status === 'success' ? 'bg-green-100 text-green-700' :
                  run.status === 'error' ? 'bg-red-100 text-red-700' :
                    run.status === 'running' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
              )}>
                {run.status}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {new Date(run.startedAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
          </div>

          <div className="text-[11px] font-medium text-slate-700 font-mono truncate leading-tight">
            $ {run.command}
          </div>

          {run.durationMs && (
            <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              <span>{(run.durationMs / 1000).toFixed(2)}s</span>
            </div>
          )}
        </div>

        <CollapsibleContent className="space-y-2 animate-in slide-in-from-top-1 duration-200">
          {(run.stdout || run.stderr) && (
            <div className="bg-slate-900 rounded-xl p-3 font-mono text-[10px] leading-relaxed overflow-auto max-h-[300px] shadow-inner border border-slate-800">
              {run.stdout && (
                <div className="text-slate-300">
                  <div className="text-[9px] uppercase tracking-widest font-bold text-slate-500 mb-1">Stdout</div>
                  <pre className="whitespace-pre-wrap">{run.stdout}</pre>
                </div>
              )}
              {run.stderr && (
                <div className="text-red-400 mt-2">
                  <div className="text-[9px] uppercase tracking-widest font-bold text-red-900 mb-1">Stderr</div>
                  <pre className="whitespace-pre-wrap">{run.stderr}</pre>
                </div>
              )}
              {run.truncated && (
                <div className="text-amber-500 mt-2 border-t border-white/5 pt-1 text-[9px] italic flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  日志过长已截断
                </div>
              )}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function LoaderIcon() {
  return (
    <div className="w-4 h-4 flex items-center justify-center">
      <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
