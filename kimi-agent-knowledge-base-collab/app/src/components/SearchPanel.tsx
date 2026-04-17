import { useState, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Entity } from '@/types/ontology';
import { cn } from '@/lib/utils';

interface SearchPanelProps {
  onSearch: (query: string) => Promise<Entity[]>;
  onSelectEntity: (entity: Entity) => void;
}

export function SearchPanel({ onSearch, onSelectEntity }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Entity[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim()) {
      setLoading(true);
      try {
        const searchResults = await onSearch(searchQuery);
        setResults(searchResults);
        setShowResults(true);
      } finally {
        setLoading(false);
      }
    } else {
      setResults([]);
      setShowResults(false);
      setLoading(false);
    }
  }, [onSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void handleSearch(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, handleSearch]);

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  const handleSelect = (entity: Entity) => {
    onSelectEntity(entity);
    setShowResults(false);
    setQuery(entity.name);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            type="text"
            placeholder="搜索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {showResults && query.trim() && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-popover/95 backdrop-blur-2xl border border-border/40 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1">
          <div className="max-h-[320px] overflow-y-auto overflow-x-hidden p-1.5 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 px-3 py-2 border-b border-border/5 mb-1 sticky top-0 bg-popover/80 backdrop-blur-md z-10 flex items-center justify-between">
              <span>找到 {results.length} 个结果</span>
              <span className="text-[8px] opacity-40">Scroll to Explore</span>
            </div>
            {results.map((entity) => (
              <button
                key={entity.id}
                onClick={() => handleSelect(entity)}
                className="w-full text-left px-3 py-3 hover:bg-primary/5 rounded-xl transition-all group relative border border-transparent hover:border-primary/10 mb-0.5 outline-hidden"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-black text-sm tracking-tight text-foreground/90 group-hover:text-primary transition-colors">{entity.name}</span>
                  <div className="flex gap-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[9px] font-bold border-none px-1.5 h-4",
                        entity.layer === 'common' && "bg-[#99AF91]/20 text-[#768A6F]",
                        entity.layer === 'domain' && "bg-[#4F83C3]/20 text-[#345C8F]",
                        entity.layer === 'private' && "bg-[#C19292]/20 text-[#9B6D6D]"
                      )}
                    >
                      {entity.layer}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-1.5 opacity-60">
                  <span className="text-[9px] font-black text-muted-foreground/80 uppercase tracking-tighter bg-muted/30 px-1 rounded">{entity.type}</span>
                  <span className="text-[9px] text-muted-foreground/30">•</span>
                  <span className="text-[9px] font-black text-muted-foreground/80 uppercase tracking-tighter">{entity.domain}</span>
                </div>
                <p className="text-[11px] text-muted-foreground/80 line-clamp-2 leading-relaxed italic group-hover:text-muted-foreground transition-colors">
                  {entity.definition}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && query.trim() && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-popover/80 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl z-50 p-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <div className="h-4 w-4 border-2 border-primary/30 border-t-primary animate-spin rounded-full" />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">搜索中...</span>
          </div>
        </div>
      )}

      {showResults && query.trim() && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-popover/80 backdrop-blur-md border border-border/40 rounded-2xl shadow-xl z-50 p-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <X className="h-4 w-4 text-muted-foreground/40" />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">未找到匹配的结果</span>
          </div>
        </div>
      )}
    </div>
  );
}
