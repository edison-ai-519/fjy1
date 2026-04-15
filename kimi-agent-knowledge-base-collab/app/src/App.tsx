import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Toaster } from '@/components/ui/sonner';
import { useOntologyData } from '@/hooks/useOntologyData';
import { useOntologyAssistantState } from '@/hooks/useOntologyAssistantState';
import { SearchPanel } from '@/components/SearchPanel';
import { OntologyBrowser } from '@/components/OntologyBrowser';
import { KnowledgeGraph } from '@/components/KnowledgeGraph';
import { EntityDetail } from '@/components/EntityDetail';
import { StatsPanel } from '@/components/StatsPanel';
import { OntologyAnalyzer } from '@/components/OntologyAnalyzer';
import { SystemsOntologyView } from '@/components/SystemsOntologyView';
import { OntologyAssistant } from '@/components/OntologyAssistant';
import { EducationHub } from '@/components/EducationHub';
import { Sidebar as AssistantSidebar } from '@/components/assistant/Sidebar';
import { AboutKnowledgeBase } from '@/components/AboutKnowledgeBase';
import { XiaoGuGitDashboard } from '@/components/XiaoGuGitDashboard';
import {
  BookOpen,
  Network,
  BarChart3,
  Database,
  Menu,
  GitBranch,
  Layers,
  Sparkles,
  Boxes,
  GraduationCap,
  FlaskConical,
  MessageSquareText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Entity, KnowledgeLayer, KnowledgeGraphData } from '@/types/ontology';

const LAYER_FILTERS: Array<{ value: 'all' | KnowledgeLayer; label: string }> = [
  { value: 'all', label: '全部层' },
  { value: 'common', label: 'Common' },
  { value: 'domain', label: 'Domain' },
  { value: 'private', label: 'Private' },
];

function buildFilteredStatistics(
  knowledgeGraph: KnowledgeGraphData | null,
  entities: Entity[],
  crossReferences: Array<{ source: string; target: string }>,
) {
  if (!knowledgeGraph) {
    return null;
  }

  const domains = [...new Set(entities.map((entity) => entity.domain).filter(Boolean))].sort();
  const levels = [...new Set(entities.map((entity) => entity.level).filter((level): level is number => typeof level === 'number'))].sort((left, right) => left - right);
  const sources = [...new Set(entities.map((entity) => entity.source).filter(Boolean))].sort();
  const layers = [...new Set(entities.map((entity) => entity.layer).filter(Boolean))] as KnowledgeLayer[];
  const orderedLayers = ['common', 'domain', 'private'].filter((layer) => layers.includes(layer as KnowledgeLayer)) as KnowledgeLayer[];
  const layerCounts = orderedLayers.reduce<Partial<Record<KnowledgeLayer, number>>>((accumulator, layer) => {
    accumulator[layer] = entities.filter((entity) => entity.layer === layer).length;
    return accumulator;
  }, {});

  return {
    ...knowledgeGraph.statistics,
    total_entities: entities.length,
    total_relations: crossReferences.length,
    domains,
    levels,
    sources,
    layers: orderedLayers,
    layer_counts: layerCounts,
  };
}

function App() {
  const {
    knowledgeGraph,
    loading,
    error,
    searchEntities
  } = useOntologyData();

  const entities = knowledgeGraph ? Object.values(knowledgeGraph.entity_index) : [];
  const crossReferences = knowledgeGraph?.cross_references || [];

  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('browse');
  const [selectedLayer, setSelectedLayer] = useState<'all' | KnowledgeLayer>('all');
  const assistantState = useOntologyAssistantState(selectedEntity);

  const filteredEntities = entities.filter((entity) => (
    selectedLayer === 'all' || entity.layer === selectedLayer
  ));
  const visibleEntityIds = new Set(filteredEntities.map((entity) => entity.id));
  const filteredCrossReferences = crossReferences.filter((reference) => (
    visibleEntityIds.has(reference.source) && visibleEntityIds.has(reference.target)
  ));
  const filteredStatistics = buildFilteredStatistics(knowledgeGraph, filteredEntities, filteredCrossReferences);

  // 数据加载完成后自动选择第一个实体
  useEffect(() => {
    if (filteredEntities.length === 0) {
      if (selectedEntity) {
        setSelectedEntity(null);
      }
      return;
    }

    if (!selectedEntity || !filteredEntities.some((entity) => entity.id === selectedEntity.id)) {
      setSelectedEntity(filteredEntities[0]);
    }
  }, [filteredEntities, selectedEntity]);

  const relatedEntities = selectedEntity
    ? filteredCrossReferences
      .map((reference) => {
        const relatedId = reference.source === selectedEntity.id ? reference.target : (
          reference.target === selectedEntity.id ? reference.source : null
        );
        return relatedId ? filteredEntities.find((entity) => entity.id === relatedId) || null : null;
      })
      .filter((entity): entity is Entity => Boolean(entity))
    : [];

  const handleSearch = async (query: string) => {
    const results = await searchEntities(query);
    return results.filter((entity) => selectedLayer === 'all' || entity.layer === selectedLayer);
  };

  const handleSelectEntity = (entity: Entity) => {
    setSelectedEntity(entity);
    setSidebarOpen(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">正在加载 WiKiMG 多层知识图谱...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center text-destructive">
          <p className="text-lg font-semibold mb-2">加载失败</p>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="w-full px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Database className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">本体论知识库</h1>
              <p className="text-xs text-muted-foreground">Ontology Knowledge Base</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden lg:flex items-center gap-1 bg-slate-100/50 p-1 rounded-2xl border border-slate-200/60 mr-2">
              {LAYER_FILTERS.map((option) => (
                <Button
                  key={option.value}
                  variant={selectedLayer === option.value ? 'default' : 'ghost'}
                  size="sm"
                  className={cn(
                    "h-8 px-3 rounded-xl text-xs font-bold transition-all",
                    selectedLayer === option.value
                      ? "bg-white shadow-md text-blue-600 hover:bg-white"
                      : "text-slate-500 hover:text-slate-900 hover:bg-white/50"
                  )}
                  onClick={() => setSelectedLayer(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            <div className="hidden md:flex items-center gap-2">
              <Badge variant="outline" className="flex items-center gap-1 rounded-full px-2 py-0.5 border-slate-200 text-[10px] font-bold">
                <GitBranch className="w-3 h-3 text-blue-500" />
                {filteredEntities.length} 实体
              </Badge>
              <Badge variant="outline" className="flex items-center gap-1 rounded-full px-2 py-0.5 border-slate-200 text-[10px] font-bold">
                <Network className="w-3 h-3 text-indigo-500" />
                {filteredCrossReferences.length} 关系
              </Badge>
            </div>

            <div className="hidden md:block w-72">
              <SearchPanel
                onSearch={handleSearch}
                onSelectEntity={handleSelectEntity}
              />
            </div>

            <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                <div className="p-4 border-b">
                  <h2 className="font-semibold">本体浏览器</h2>
                </div>
                <div className="p-4">
                  <OntologyBrowser
                    entities={filteredEntities}
                    crossReferences={filteredCrossReferences}
                    onSelectEntity={handleSelectEntity}
                    selectedEntityId={selectedEntity?.id}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="w-full flex-1 min-h-0 overflow-hidden bg-background">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full min-h-0 gap-0 lg:flex-row">
          <div className="w-full shrink-0 border-r bg-slate-50/30 lg:w-[300px] xl:w-[320px] lg:h-[calc(100vh-80px)] overflow-hidden flex flex-col">
            <div className="p-4 flex flex-col h-full min-h-0 gap-4">
              <TabsList className="flex h-auto w-full flex-row flex-wrap gap-1 rounded-3xl border bg-card/80 p-1.5 shadow-sm lg:flex-col shrink-0">
                <TabsTrigger value="browse" title="库管理" className="flex-1 lg:w-full justify-start rounded-2xl px-3 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-md">
                  <BookOpen className="mr-2 h-4 w-4 text-primary/70" />
                  <span className="font-bold text-xs uppercase tracking-tight">库管理</span>
                </TabsTrigger>
                <TabsTrigger value="workspace" title="工作台" className="flex-1 lg:w-full justify-start rounded-2xl px-3 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-md">
                  <GitBranch className="mr-2 h-4 w-4 text-primary/70" />
                  <span className="font-bold text-xs uppercase tracking-tight">工作台</span>
                </TabsTrigger>
                <TabsTrigger value="assistant" title="问答助手" className="flex-1 lg:w-full justify-start rounded-2xl px-3 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-md">
                  <MessageSquareText className="mr-2 h-4 w-4 text-primary/70" />
                  <span className="font-bold text-xs uppercase tracking-tight">问答助手</span>
                </TabsTrigger>
                <TabsTrigger value="lab" title="本体实验室" className="flex-1 lg:w-full justify-start rounded-2xl px-3 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-md">
                  <FlaskConical className="mr-2 h-4 w-4 text-primary/70" />
                  <span className="font-bold text-xs uppercase tracking-tight">本体实验室</span>
                </TabsTrigger>
                <TabsTrigger value="graph" title="知识图谱" className="flex-1 lg:w-full justify-start rounded-2xl px-3 py-2.5 data-[state=active]:bg-white data-[state=active]:shadow-md">
                  <Network className="mr-2 h-4 w-4 text-primary/70" />
                  <span className="font-bold text-xs uppercase tracking-tight">知识图谱</span>
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 min-h-0">
                {activeTab === 'browse' && (
                  <OntologyBrowser
                    entities={filteredEntities}
                    crossReferences={filteredCrossReferences}
                    onSelectEntity={handleSelectEntity}
                    selectedEntityId={selectedEntity?.id}
                  />
                )}
                {activeTab === 'assistant' && (
                  <AssistantSidebar
                    sessions={assistantState.sessions}
                    activeSessionId={assistantState.activeSessionId}
                    onSelectSession={assistantState.setActiveSessionId}
                    onNewSession={assistantState.onNewSession}
                    onDeleteSession={assistantState.onDeleteSession}
                    isBusy={assistantState.isBusy}
                  />
                )}
                {(activeTab === 'workspace' || activeTab === 'lab' || activeTab === 'graph') && (
                  <div className="h-full rounded-3xl border border-slate-200/60 bg-white/40 p-6 flex flex-col items-center justify-center text-center backdrop-blur-sm shadow-sm">
                    <div className="w-12 h-12 rounded-full bg-slate-100/50 flex items-center justify-center mb-4">
                      <Sparkles className="w-6 h-6 text-slate-400" />
                    </div>
                    <h3 className="text-sm font-bold text-slate-600 mb-1">当前模块未开启侧栏</h3>
                    <p className="text-xs text-slate-400">
                      该功能模块的核心操作区位于主视图中。
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <TabsContent value="browse" className="mt-0 h-full flex-1 min-h-0 animate-in fade-in duration-500">
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                {selectedEntity && (
                  <div className="animate-in fade-in slide-in-from-top-4 duration-500">
                    <EntityDetail
                      entity={selectedEntity}
                      relatedEntities={relatedEntities}
                      onSelectRelated={handleSelectEntity}
                    />
                  </div>
                )}

                {!selectedEntity ? (
                  <div className="space-y-6">
                    <div className="rounded-3xl border bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 text-white overflow-hidden shadow-2xl">
                      <div className="grid gap-6 px-8 py-10 lg:grid-cols-[1.6fr_1fr]">
                        <div>
                          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[10px] uppercase tracking-wider font-bold">
                            <BookOpen className="w-3.5 h-3.5" />
                            WiKiMG 知识全景
                          </div>
                          <h2 className="mt-6 text-3xl font-bold lg:text-5xl leading-tight">
                            从左侧侧栏选取概念<br />开启深度语义阅读
                          </h2>
                          <p className="mt-4 max-w-2xl text-slate-300 text-sm lg:text-base leading-relaxed">
                            左侧本体树已整合全量节点，在此处您将看到节点的工业级定义、跨层关联关系以及多维度的属性特征。
                          </p>
                        </div>
                        <div className="flex items-center justify-center">
                          <div className="grid grid-cols-2 gap-4 w-full max-w-[320px]">
                            <div className="rounded-2xl bg-white/5 border border-white/10 p-5 text-center backdrop-blur-md">
                              <div className="text-[10px] text-slate-400 uppercase font-black">Total Nodes</div>
                              <div className="mt-1 text-2xl font-black tracking-tighter">{filteredEntities.length}</div>
                            </div>
                            <div className="rounded-2xl bg-white/5 border border-white/10 p-5 text-center backdrop-blur-md">
                              <div className="text-[10px] text-slate-400 uppercase font-black">References</div>
                              <div className="mt-1 text-2xl font-black tracking-tighter">{filteredCrossReferences.length}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-white border rounded-3xl p-6 shadow-sm hover:shadow-md transition-all group">
                        <div className="flex items-center gap-4 mb-4">
                          <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl group-hover:bg-blue-600 group-hover:text-white transition-colors">
                            <BookOpen className="w-6 h-6" />
                          </div>
                          <h3 className="font-bold">哲学本体</h3>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">涵盖存在论、范畴论、属性论等形而上学核心。从传统哲学到现代分析的演进脉络。</p>
                      </div>
                      <div className="bg-white border rounded-3xl p-6 shadow-sm hover:shadow-md transition-all group">
                        <div className="flex items-center gap-4 mb-4">
                          <div className="p-3 bg-green-50 text-green-600 rounded-2xl group-hover:bg-green-600 group-hover:text-white transition-colors">
                            <Layers className="w-6 h-6" />
                          </div>
                          <h3 className="font-bold">形式本体</h3>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">BFO, DOLCE 等顶层本体，以及 OWL/RDF 等形式化逻辑。支撑语义网的骨干。</p>
                      </div>
                      <div className="bg-white border rounded-3xl p-6 shadow-sm hover:shadow-md transition-all group">
                        <div className="flex items-center gap-4 mb-4">
                          <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl group-hover:bg-purple-600 group-hover:text-white transition-colors">
                            <Network className="w-6 h-6" />
                          </div>
                          <h3 className="font-bold">科学本体</h3>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">从物质探测到认知涌现的层次结构，跨越物理、生物与社会系统的集成模型。</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider">
                        <BarChart3 className="w-3.5 h-3.5 text-blue-500" />
                        运行实时指标
                      </div>
                      <StatsPanel statistics={filteredStatistics} />
                    </div>
                  </div>
                ) : (
                  <div className="pt-10 border-t border-dashed">
                    <div className="flex items-center justify-between mb-6">
                      <h4 className="text-sm font-bold text-slate-900">库全局统计</h4>
                      <Badge variant="outline" className="text-[10px] font-medium opacity-50">Background metrics</Badge>
                    </div>
                    <StatsPanel statistics={filteredStatistics} />
                  </div>
                )}

                <AboutKnowledgeBase />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="assistant" className="mt-0 h-full flex-1 min-h-0">
            <OntologyAssistant
              activeSession={assistantState.activeSession}
              businessPrompt={assistantState.businessPrompt}
              isBusy={assistantState.isBusy}
              modelName={assistantState.modelName}
              onAsk={assistantState.onAsk}
              onBusinessPromptChange={assistantState.setBusinessPrompt}
              onDraftChange={assistantState.onDraftChange}
              onModelNameChange={assistantState.setModelName}
              selectedEntityName={selectedEntity?.name}
              executionStages={assistantState.currentExecutionStages}
            />
          </TabsContent>

          <TabsContent value="lab" className="mt-0 h-full flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                <div className="mb-4 w-full rounded-3xl border bg-slate-50 p-1 shadow-inner">
                  <Tabs defaultValue="analyzer" className="w-full">
                    <div className="flex flex-col gap-4 border-b bg-white px-4 py-3 lg:flex-row lg:items-center lg:justify-between rounded-t-3xl">
                      <div className="flex items-center gap-2 min-w-0">
                        <FlaskConical className="w-5 h-5 text-blue-500" />
                        <h2 className="text-lg font-bold break-words">深度分析实验室</h2>
                      </div>
                      <TabsList className="w-full flex-wrap justify-start bg-slate-100/50 p-1 rounded-xl lg:w-auto">
                        <TabsTrigger value="analyzer" className="rounded-lg px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                          <Sparkles className="w-4 h-4 mr-2" /> 概率分析
                        </TabsTrigger>
                        <TabsTrigger value="systems" className="rounded-lg px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                          <Boxes className="w-4 h-4 mr-2" /> 系统视图
                        </TabsTrigger>
                        <TabsTrigger value="education" className="rounded-lg px-4 py-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                          <GraduationCap className="w-4 h-4 mr-2" /> 知识科普
                        </TabsTrigger>
                      </TabsList>
                    </div>

                    <div className="mt-6">
                      <TabsContent value="analyzer" className="mt-0">
                        <OntologyAnalyzer
                          entities={filteredEntities}
                          selectedEntity={selectedEntity}
                          onSelectEntity={handleSelectEntity}
                        />
                      </TabsContent>
                      <TabsContent value="systems" className="mt-0">
                        <SystemsOntologyView
                          entities={filteredEntities}
                          selectedEntity={selectedEntity}
                          onSelectEntity={handleSelectEntity}
                        />
                      </TabsContent>
                      <TabsContent value="education" className="mt-0">
                        <EducationHub selectedEntity={selectedEntity} />
                      </TabsContent>
                    </div>
                  </Tabs>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="graph" className="mt-0 h-full flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <KnowledgeGraph
                      entities={filteredEntities}
                      crossReferences={filteredCrossReferences}
                      onSelectEntity={handleSelectEntity}
                      selectedEntityId={selectedEntity?.id}
                    />
                  </div>
                  <div className="lg:col-span-1">
                    <EntityDetail
                      entity={selectedEntity}
                      relatedEntities={relatedEntities}
                      onSelectRelated={handleSelectEntity}
                    />
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="workspace" className="mt-0 h-full flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                <div className="rounded-3xl border bg-gradient-to-r from-blue-600 to-indigo-700 text-white overflow-hidden mb-6">
                  <div className="px-6 py-6 lg:px-8">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs">
                      <GitBranch className="w-3.5 h-3.5" />
                      统一本体工作台 (Unified Workspace)
                    </div>
                    <h2 className="mt-4 text-2xl font-semibold">
                      本体版本管理与实时编辑
                    </h2>
                    <p className="mt-2 text-sm text-blue-100 opacity-80">
                      取代了旧版的离线编辑器。支持 Git 级的历史记录管理，并在每次写入时自动触发概率推理服务。
                    </p>
                  </div>
                </div>
                <XiaoGuGitDashboard />
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </main>

      <Toaster />
    </div>
  );
}

export default App;
