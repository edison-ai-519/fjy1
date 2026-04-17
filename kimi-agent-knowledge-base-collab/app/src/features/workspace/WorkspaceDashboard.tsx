import { FileContentPanel } from '@/features/workspace/components/FileContentPanel';
import { FileListPanel } from '@/features/workspace/components/FileListPanel';
import { GraphIngestPanel } from '@/features/workspace/components/GraphIngestPanel';
import { ProbabilityPanel } from '@/features/workspace/components/ProbabilityPanel';
import { ProjectListPanel } from '@/features/workspace/components/ProjectListPanel';
import { RecommendationPanel } from '@/features/workspace/components/RecommendationPanel';
import { TimelinePanel } from '@/features/workspace/components/TimelinePanel';
import { DiffDialog } from '@/features/workspace/components/DiffDialog';
import { useWorkspaceState } from '@/features/workspace/useWorkspaceState';

export function WorkspaceDashboard() {
  const workspace = useWorkspaceState();

  const handleSelectFile = async (filename: string) => {
    workspace.setSelectedFile(filename);
    await workspace.loadContent(workspace.selectedProjectId, filename);
  };

  const handleSourceCommitted = async (projectId: string, filename: string) => {
    workspace.setSelectedProjectId(projectId);
    await workspace.loadTimelines(projectId);
    workspace.setSelectedFile(filename);
    await workspace.loadContent(projectId, filename);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-3 flex flex-col h-full space-y-6">
          <ProjectListPanel
            className="h-[600px]"
            projects={workspace.projects}
            selectedProjectId={workspace.selectedProjectId}
            loading={workspace.loading}
            newProjectId={workspace.newProjectId}
            setNewProjectId={workspace.setNewProjectId}
            newProjectName={workspace.newProjectName}
            setNewProjectName={workspace.setNewProjectName}
            isNewProjectOpen={workspace.isNewProjectOpen}
            setIsNewProjectOpen={workspace.setIsNewProjectOpen}
            onSelectProject={workspace.setSelectedProjectId}
            onRefresh={workspace.loadProjects}
            onInitProject={workspace.handleInitProject}
            onDeleteProject={workspace.handleDeleteProject}
          />
          <FileListPanel className="flex-1" timelines={workspace.timelines} selectedFile={workspace.selectedFile} onSelectFile={handleSelectFile} />
        </div>
        <div className="lg:col-span-9 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <FileContentPanel selectedFile={workspace.selectedFile} fileContent={workspace.fileContent} onRefresh={() => workspace.loadContent(workspace.selectedProjectId, workspace.selectedFile)} />
            <GraphIngestPanel onSourceCommitted={handleSourceCommitted} />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <TimelinePanel selectedFile={workspace.selectedFile} timelines={workspace.timelines} onViewDiff={workspace.handleViewDiff} onSetOfficial={workspace.handleSetOfficial} onRollback={workspace.handleRollback} />
            <ProbabilityPanel probInput={workspace.probInput} setProbInput={workspace.setProbInput} probResult={workspace.probResult} analyzing={workspace.analyzing} onAnalyze={workspace.handleProbAnalysis} />
          </div>
          <RecommendationPanel />
        </div>
      </div>
      <DiffDialog open={workspace.isDiffOpen} onOpenChange={workspace.setIsDiffOpen} diffData={workspace.diffData} compareTarget={workspace.compareTarget} />
    </div>
  );
}
