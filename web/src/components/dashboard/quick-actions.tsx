import { motion } from "motion/react";
import { Play, Pause, RotateCcw, Power, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ActionButton {
  icon: typeof Play;
  label: string;
  variant: "default" | "destructive" | "outline";
  color: string;
}

const actions: ActionButton[] = [
  { icon: Play, label: "Start All", variant: "default", color: "#34d399" },
  { icon: Pause, label: "Pause", variant: "outline", color: "#d4a373" },
  { icon: RotateCcw, label: "Restart", variant: "outline", color: "#e26d4d" },
  { icon: RefreshCw, label: "Refresh", variant: "outline", color: "#fb7185" },
  { icon: Power, label: "Shutdown", variant: "destructive", color: "#e5484d" },
];

export function QuickActions() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-primary">QUICK ACTIONS</h2>
        <span className="text-xs text-muted-foreground">[ AUTHORIZED ACCESS ]</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {actions.map((action, idx) => (
          <motion.div
            key={action.label}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: idx * 0.05 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button
              variant={action.variant}
              className="w-full h-auto flex flex-col items-center gap-2 py-4 relative overflow-hidden group"
            >
              <motion.div
                className="absolute inset-0 opacity-0 group-hover:opacity-100"
                style={{
                  background: `radial-gradient(circle at center, ${action.color}20, transparent)`,
                }}
                animate={{
                  scale: [0, 1.5],
                  opacity: [0.5, 0],
                }}
                transition={{
                  duration: 1,
                  repeat: Infinity,
                }}
              />
              <action.icon className="w-5 h-5" style={{ color: action.variant === "default" ? "#0a0e1a" : action.color }} />
              <span className="text-xs">{action.label}</span>
            </Button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
