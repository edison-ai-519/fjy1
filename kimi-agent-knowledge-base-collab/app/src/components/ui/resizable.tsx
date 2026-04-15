import * as React from "react"
import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "bg-border focus-visible:ring-ring relative z-50 flex w-px shrink-0 touch-none cursor-col-resize items-center justify-center transition-colors focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden hover:bg-blue-400 group/handle after:absolute after:left-1/2 after:top-1/2 after:!inset-y-auto after:!h-20 after:!w-2.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-transparent data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:cursor-row-resize data-[panel-group-direction=vertical]:after:left-1/2 data-[panel-group-direction=vertical]:after:top-1/2 data-[panel-group-direction=vertical]:after:!h-2.5 data-[panel-group-direction=vertical]:after:!w-20 data-[panel-group-direction=vertical]:after:-translate-x-1/2 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-20 flex h-6 w-3 items-center justify-center rounded-full border bg-white shadow-sm transition-all group-hover/handle:scale-110 group-hover/handle:border-blue-300">
          <GripVerticalIcon className="size-3 text-slate-400 group-hover/handle:text-blue-500" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
