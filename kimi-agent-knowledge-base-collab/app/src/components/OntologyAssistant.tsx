import { useEffect, useMemo, useState } from 'react';
import {
  Settings2,
  Layers,
  PanelRightOpen,
  PanelRightClose,
  Network,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import {
  CUSTOM_MODEL_KEY,
  MODEL_PRESETS,
} from '@/hooks/useOntologyAssistantState';
import {
  fetchKnowledgeGraphSlice,
  type KnowledgeGraphSliceResponse,
} from '@/features/ontology/api';
import { cn } from '@/lib/utils';

import { ChatArea } from './assistant/ChatArea';
import { ExecutionFlow } from './assistant/ExecutionFlow';
import { stopPointerEventPropagation } from './assistant/pointerGuards';
import type { ConversationExecutionStage, ConversationSession } from './assistant/types';
import { collectWikimgShowRefs } from './assistant/wikimgGraph';

interface AssistantProps {
  activeSession: ConversationSession | null;
  businessPrompt: string;
  isBusy: boolean;
  modelName: string;
  onAsk: (question?: string) => void;
  onBusinessPromptChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onModelNameChange: (value: string) => void;
  onStop: () => void;
  selectedEntityName?: string;
  executionStages: ConversationExecutionStage[];
}

export function OntologyAssistant({
  activeSession,
  businessPrompt,
  isBusy,
  modelName,
  onAsk,
  onBusinessPromptChange,
  onDraftChange,
  onModelNameChange,
  onStop,
  selectedEntityName,
  executionStages,
}: AssistantProps) {
  const [showFlow, setShowFlow] = useState(false);

  const viewedRefs = useMemo(
    () => collectWikimgShowRefs(activeSession?.messages),
    [activeSession?.messages],
  );
  const [graphSlice, setGraphSlice] = useState<KnowledgeGraphSliceResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const resolveRefs = async () => {
      if (viewedRefs.length === 0) {
        setGraphSlice(null);
        return;
      }

      try {
        const slice = await fetchKnowledgeGraphSlice(viewedRefs);
        if (!cancelled) {
          setGraphSlice(slice);
        }
      } catch {
        if (!cancelled) {
          setGraphSlice({
            viewedRefs,
            missingRefs: [],
            entities: [],
            crossReferences: [],
          });
        }
      }
    };

    void resolveRefs();

    return () => {
      cancelled = true;
    };
  }, [viewedRefs]);

  const showKnowledgeGraph = Boolean(graphSlice && graphSlice.entities.length > 0);
  const hasViewCommand = viewedRefs.length > 0;
  const sidePanelWidth = showKnowledgeGraph || hasViewCommand ? 'w-[460px]' : 'w-[340px]';

  if (!activeSession) {
    return null;
  }

  return (
    <div className="flex h-full max-h-full min-h-0 min-w-0 w-full overflow-hidden bg-background text-foreground">
      {/* Main Chat Area */}
      <div
        className="relative flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden"
        onPointerDownCapture={stopPointerEventPropagation}
      >
        <ChatArea
          activeSession={activeSession}
          onAsk={onAsk}
          onDraftChange={onDraftChange}
          onStop={onStop}
          isBusy={isBusy}
          selectedEntityName={selectedEntityName}
          renderSettings={() => (
            /* 只放设置栏在左侧 */
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 rounded-2xl border-border bg-card p-5 shadow-2xl" align="start">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-border pb-2">
                    <Layers className="h-4 w-4 text-primary" />
                    <h4 className="font-bold text-foreground">助手配置</h4>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                      推理引擎
                    </label>
                    <Select
                      value={MODEL_PRESETS.some((preset) => preset.value === modelName) ? modelName : CUSTOM_MODEL_KEY}
                      onValueChange={(value) => onModelNameChange(value === CUSTOM_MODEL_KEY ? '' : value)}
                    >
                      <SelectTrigger className="h-10 rounded-xl">
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {MODEL_PRESETS.map((preset) => (
                          <SelectItem key={preset.value} value={preset.value}>
                            {preset.label}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_MODEL_KEY}>自定义模型</SelectItem>
                      </SelectContent>
                    </Select>
                    {!MODEL_PRESETS.some((preset) => preset.value === modelName) ? (
                      <Input
                        value={modelName}
                        onChange={(event) => onModelNameChange(event.target.value)}
                        placeholder="名称..."
                        className="mt-2 h-10 rounded-xl"
                      />
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                      全局指令 (Prompt)
                    </label>
                    <Textarea
                      value={businessPrompt}
                      onChange={(event) => onBusinessPromptChange(event.target.value)}
                      placeholder="定制助手的行为..."
                      className="min-h-[140px] resize-none rounded-xl text-sm"
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          renderExtraActions={() => (
            /* 执行流程按钮放在右侧 */
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowFlow(!showFlow)}
              className={cn(
                "h-8 w-8 rounded-lg transition-all",
                showFlow ? "text-primary bg-primary/10 hover:bg-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              title={showFlow ? "关闭执行流程" : "打开执行流程"}
            >
              {showFlow ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </Button>
          )}
        />
      </div>

      {/* Right Side Panel */}
      <div
        className={cn(
          'shrink-0 h-full transition-all duration-300 ease-in-out overflow-hidden border-l',
          (showKnowledgeGraph || showFlow) ? `${sidePanelWidth} opacity-100` : 'w-0 opacity-0 border-transparent',
        )}
      >
        {showKnowledgeGraph && graphSlice ? (
          <div
            className="flex h-full w-[460px] flex-col bg-background"
            onPointerDownCapture={stopPointerEventPropagation}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-card px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground/90">
                    知识图谱
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    命中 `./wikimg.sh show`，共 {graphSlice.viewedRefs.length} 个节点
                  </div>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-primary">
                弹出
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <KnowledgeGraph
                entities={graphSlice.entities}
                crossReferences={graphSlice.crossReferences}
                onSelectEntity={() => {}}
                selectedEntityId={graphSlice.entities[0]?.id}
              />
            </div>
          </div>
        ) : hasViewCommand ? (
          <div
            className="flex h-full w-[340px] flex-col items-center justify-center gap-3 border-border/40 bg-background px-5 text-center"
            onPointerDownCapture={stopPointerEventPropagation}
          >
            <div className="rounded-full bg-muted/50 p-3">
              <Network className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-foreground/90">
                已识别 `./wikimg.sh show`
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {graphSlice?.missingRefs?.length
                  ? `这些引用在当前 markdown 源中未找到：${graphSlice.missingRefs.join('、')}`
                  : '但当前知识库里没找到可展示的节点。'}
              </div>
            </div>
          </div>
        ) : showFlow ? (
          <div
            className="h-full w-[340px]"
            onPointerDownCapture={stopPointerEventPropagation}
          >
            <ExecutionFlow executionStages={executionStages} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
