import type { XgProject, XgTimeline } from '@/features/workspace/api';

export function pickSelectedProjectId(projects: Array<Pick<XgProject, 'id'>>, currentProjectId: string): string {
  if (projects.some((project) => project.id === currentProjectId)) {
    return currentProjectId;
  }

  return projects[0]?.id || '';
}

export function pickSelectedFile(timelines: Array<Pick<XgTimeline, 'filename'>>, currentFilename: string): string {
  if (timelines.some((timeline) => timeline.filename === currentFilename)) {
    return currentFilename;
  }

  return timelines[0]?.filename || '';
}

export function syncEditorStateFromContent(filename: string, content: unknown): {
  writeFilename: string;
  writeData: string;
} {
  return {
    writeFilename: filename,
    writeData: JSON.stringify(content, null, 2),
  };
}
