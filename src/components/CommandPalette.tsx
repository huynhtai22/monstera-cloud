"use client"

import * as React from "react"
import { Command } from "cmdk"
import { useRouter } from "next/navigation"
import { Search, Settings, Link as LinkIcon, Terminal, Activity, FileJson } from "lucide-react"

export function CommandPalette() {
  const [open, setOpen] = React.useState(false)
  const router = useRouter()

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  const runCommand = (command: () => void) => {
    setOpen(false)
    command()
  }

  return (
    <Command.Dialog 
      open={open} 
      onOpenChange={setOpen}
      label="Global Command Menu"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-2xl bg-[#0a0a0a] border border-gray-800 rounded-xl shadow-[0_0_50px_rgba(16,185,129,0.1)] overflow-hidden flex flex-col font-mono" cmdk-root="">
        <div className="flex items-center border-b border-gray-800 px-3">
          <Search className="w-5 h-5 text-gray-500 shrink-0" />
          <Command.Input 
            autoFocus
            placeholder="Type a command or search..." 
            className="flex-1 bg-transparent border-0 py-4 px-3 text-emerald-400 placeholder:text-gray-600 focus:ring-0 outline-none w-full text-base"
          />
          <div className="text-xs text-gray-600 bg-gray-900 px-2 py-1 rounded">ESC</div>
        </div>
        <Command.List className="max-h-[350px] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-gray-500">No results found.</Command.Empty>
          
          <Command.Group heading="Navigation" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-gray-500 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest mb-2">
            
            <Command.Item 
              onSelect={() => runCommand(() => router.push("/dashboard"))}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-gray-300 cursor-pointer data-[selected=true]:bg-gray-900 data-[selected=true]:text-emerald-400 transition-colors"
            >
              <Terminal className="w-4 h-4 text-emerald-500" />
              Command Center
            </Command.Item>

            <Command.Item 
              onSelect={() => runCommand(() => router.push("/dashboard/connections"))}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-gray-300 cursor-pointer data-[selected=true]:bg-gray-900 data-[selected=true]:text-emerald-400 transition-colors"
            >
              <LinkIcon className="w-4 h-4 text-amber-500" />
              Connections
            </Command.Item>

            <Command.Item 
              onSelect={() => runCommand(() => router.push("/settings"))}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-gray-300 cursor-pointer data-[selected=true]:bg-gray-900 data-[selected=true]:text-emerald-400 transition-colors"
            >
              <Settings className="w-4 h-4 text-gray-400" />
              VPC & API Keys
            </Command.Item>

            <Command.Item 
              onSelect={() => runCommand(() => router.push("/dashboard/logs"))}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-gray-300 cursor-pointer data-[selected=true]:bg-gray-900 data-[selected=true]:text-emerald-400 transition-colors"
            >
              <Activity className="w-4 h-4 text-blue-500" />
              Sync Logs
            </Command.Item>

            <Command.Item 
              onSelect={() => runCommand(() => console.log('Simulating Google Sheets Export'))}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-gray-300 cursor-pointer data-[selected=true]:bg-gray-900 data-[selected=true]:text-emerald-400 transition-colors"
            >
              <FileJson className="w-4 h-4 text-purple-500" />
              Export to .CSV
            </Command.Item>

          </Command.Group>
          
        </Command.List>
      </div>
    </Command.Dialog>
  )
}
