import {
  Settings2,
  Layers,
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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  CUSTOM_MODEL_KEY,
  MODEL_PRESETS,
} from '@/hooks/useOntologyAssistantState';

import { ChatArea } from './assistant/ChatArea';
import { ExecutionFlow } from './assistant/ExecutionFlow';
import { ASSISTANT_PANEL_LAYOUT } from './assistant/panelLayout';
import type { ConversationExecutionStage, ConversationSession } from './assistant/types';

interface AssistantProps {
  activeSession: ConversationSession | null;
  businessPrompt: string;
  isBusy: boolean;
  modelName: string;
  onAsk: (question?: string) => void;
  onBusinessPromptChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onModelNameChange: (value: string) => void;
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
  selectedEntityName,
  executionStages,
}: AssistantProps) {
  if (!activeSession) {
    return null;
  }

  return (
    <div className="h-full max-h-full min-h-0 w-full overflow-hidden rounded-3xl border bg-white shadow-sm flex flex-col">
      <ResizablePanelGroup orientation="horizontal" id="assistant-primary-group" className="flex-1 min-h-0">
        <ResizablePanel
          id="chat-panel"
          defaultSize={ASSISTANT_PANEL_LAYOUT.chat.defaultSize}
          minSize={ASSISTANT_PANEL_LAYOUT.chat.minSize}
        >
          <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            <ChatArea
              activeSession={activeSession}
              onAsk={onAsk}
              onDraftChange={onDraftChange}
              isBusy={isBusy}
              selectedEntityName={selectedEntityName}
              renderSettings={() => (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-full border bg-white/90 shadow-sm hover:border-slate-300 transition-colors"
                    >
                      <Settings2 className="h-3.5 w-3.5 text-slate-500" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 rounded-3xl border-slate-100 p-5 shadow-2xl" align="end">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 border-b pb-2">
                        <Layers className="h-4 w-4 text-blue-500" />
                        <h4 className="font-bold text-slate-800">助手配置</h4>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
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
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
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
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          id="flow-panel"
          defaultSize={ASSISTANT_PANEL_LAYOUT.flow.defaultSize}
          minSize={ASSISTANT_PANEL_LAYOUT.flow.minSize}
        >
          <ExecutionFlow executionStages={executionStages} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
