import { RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

interface FileContentPanelProps {
  selectedFile: string;
  fileContent: unknown;
  onRefresh: () => void | Promise<void>;
}

export function FileContentPanel({ selectedFile, fileContent, onRefresh }: FileContentPanelProps) {
  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md shadow-2xl overflow-hidden flex flex-col h-[600px] rounded-3xl">
      <CardHeader className="bg-muted/10 border-b border-border/20 flex flex-row items-center justify-between px-6 py-4">
        <div>
          <CardTitle className="text-xs font-black uppercase tracking-[0.2em] flex items-center gap-3 text-muted-foreground/80">
            当前内容
            <Badge variant="outline" className="font-mono text-[10px] rounded-md border-border/40 px-2 bg-muted/20">
              {selectedFile || '未选择文件'}
            </Badge>
          </CardTitle>
          <CardDescription className="text-[11px] font-medium text-muted-foreground/60 mt-1">读取 XiaoGuGit 存储的最新版本</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={onRefresh} className="rounded-full hover:bg-muted/50">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0 bg-muted/40 dark:bg-zinc-950 overflow-hidden border-t border-border/20">
        <ScrollArea className="h-full w-full">
          <pre className="p-6 text-[13px] text-foreground/80 dark:text-primary/70 font-mono leading-relaxed selection:bg-primary/20">
            {fileContent ? JSON.stringify(fileContent, null, 2) : '// 选择文件以查看内容'}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
