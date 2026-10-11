import { motion } from "motion/react";
import { Cpu, HardDrive, Activity, Thermometer } from "lucide-react";
import { useSystemStatus } from "@/hooks/use-system-data";

export function SystemStatus() {
    const { data, isLoading } = useSystemStatus();

    // Default/Loading state
    if (isLoading || !data) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
                {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-24 rounded-lg bg-card/50 border border-border" />
                ))}
            </div>
        );
    }

    // Transform API data to UI format
    const metrics = [
        { 
            icon: Cpu, 
            label: "CPU Usage", 
            value: data.cpu, 
            unit: "%", 
            color: "#e26d4d" 
        },
        { 
            icon: HardDrive, 
            label: "Storage", 
            value: data.storage, 
            unit: "%", 
            color: "#34d399" 
        },
        { 
            icon: Activity, 
            label: "Memory", 
            value: data.memory, 
            unit: "%", 
            color: "#d4a373" 
        },
        { 
            icon: Thermometer, 
            label: "Temperature", 
            value: data.temperature, 
            unit: "°C", 
            color: "#fb7185" 
        },
    ];

    return (
        <section className="space-y-4">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-primary">SYSTEM VITALS</h2>
                <motion.div
                    className="flex items-center gap-2 text-xs text-accent"
                    animate={{ opacity: [1, 0.5, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                >
                    <div className="w-2 h-2 rounded-full bg-accent" />
                    <span>REAL-TIME MONITORING</span>
                </motion.div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {metrics.map((metric, idx) => (
                    <motion.div
                        key={metric.label}
                        className="p-4 rounded-lg border border-border bg-card/50 backdrop-blur-sm"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.5, delay: idx * 0.1 }}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <metric.icon className="w-4 h-4" style={{ color: metric.color }} />
                                <span className="text-sm text-card-foreground">{metric.label}</span>
                            </div>
                            <span className="text-sm" style={{ color: metric.color }}>
                                {metric.value}{metric.unit}
                            </span>
                        </div>
                        <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                            <motion.div
                                className="absolute top-0 left-0 h-full rounded-full"
                                style={{
                                    background: `linear-gradient(90deg, ${metric.color}, ${metric.color}dd)`,
                                    boxShadow: `0 0 10px ${metric.color}66`,
                                }}
                                initial={{ width: 0 }}
                                animate={{ width: `${metric.value}%` }}
                                transition={{ duration: 1, delay: idx * 0.1 + 0.3 }}
                            />
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Network Activity */}
            <motion.div
                className="p-4 rounded-lg border border-border bg-card/50 backdrop-blur-sm"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
            >
                <h3 className="text-sm text-card-foreground mb-3">NETWORK ACTIVITY</h3>
                <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                        <span className="text-muted-foreground">Uplink</span>
                        <span className="text-accent">{data.network.up}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        <span className="text-muted-foreground">Downlink</span>
                        <span className="text-primary">{data.network.down}</span>
                    </div>
                </div>
            </motion.div>
        </section>
    );
}