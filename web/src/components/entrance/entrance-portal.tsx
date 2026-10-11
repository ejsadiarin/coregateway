import { motion } from "motion/react";
import { Server, Zap, Shield, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Particles } from "@/components/ui/particles";
import { useNavigate } from "react-router-dom";

export function EntrancePortal() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-dvh flex items-center justify-center overflow-hidden">
      {/* Animated Grid Background */}
      <div className="absolute inset-0 opacity-30">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
            linear-gradient(rgba(226, 109, 77, 0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(226, 109, 77, 0.07) 1px, transparent 1px)
          `,
            backgroundSize: "50px 50px",
            animation: "grid-glow 4s ease-in-out infinite",
          }}
        />
      </div>

      {/* Scanning Line Effect */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="scan-line absolute w-full h-px bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />
      </div>

      {/* Floating Particles */}
      <div className="absolute inset-0 pointer-events-none">
        <Particles
          className="absolute inset-0"
          quantity={40}
          color="#e26d4d"
          staticity={60}
          ease={60}
          size={0.6}
        />
      </div>

      {/* Main Content */}
      <section className="relative z-10 text-center px-4 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          {/* Status Indicators */}
          <section className="flex justify-center gap-6 mb-12">
            {[
              { icon: Server, label: "SYSTEMS", status: "ONLINE" },
              { icon: Shield, label: "SECURITY", status: "ACTIVE" },
              { icon: Zap, label: "POWER", status: "OPTIMAL" },
            ].map((item, idx) => (
              <motion.div
                key={item.label}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/30 bg-card backdrop-blur-sm"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
              >
                <item.icon
                  className="w-4 h-4 text-primary"
                  style={{ animation: "glow-pulse 2s ease-in-out infinite" }}
                />
                <div className="flex flex-col items-start">
                  <span className="text-xs text-muted-foreground">
                    {item.label}
                  </span>
                  <span className="text-xs text-accent">{item.status}</span>
                </div>
              </motion.div>
            ))}
          </section>

          {/* Main Title */}
          <motion.h1
            className="mb-6 text-primary text-4xl md:text-6xl font-bold tracking-tighter"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            CORE SYSTEM PORTAL
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            className="mb-4 text-muted-foreground max-w-2xl mx-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
          >
            Welcome to the central management interface for your homelab
            infrastructure. All systems are operational and awaiting commands.
          </motion.p>

          {/* Version Badge */}
          <motion.section
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-accent/30 bg-accent/10 mb-12"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
          >
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-xs text-accent">
              CORE v1.0.0 | MATRIX ACTIVE
            </span>
          </motion.section>

          {/* Central Hexagon Portal */}
          <motion.div
            className="relative w-64 h-64 mx-auto mb-12"
            initial={{ opacity: 0, scale: 0.8, rotate: -180 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1, delay: 0.8 }}
          >
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <defs>
                <linearGradient
                  id="hexGradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#e26d4d" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#d4a373" stopOpacity="0.8" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <motion.polygon
                points="50,5 90,30 90,70 50,95 10,70 10,30"
                fill="none"
                stroke="url(#hexGradient)"
                strokeWidth="0.5"
                filter="url(#glow)"
                animate={{
                  strokeOpacity: [0.3, 0.8, 0.3],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              <motion.polygon
                points="50,15 80,32.5 80,67.5 50,85 20,67.5 20,32.5"
                fill="none"
                stroke="url(#hexGradient)"
                strokeWidth="0.3"
                animate={{
                  strokeOpacity: [0.8, 0.3, 0.8],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: 0.5,
                }}
              />
              <circle cx="50" cy="50" r="8" fill="#e26d4d" opacity="0.6">
                <animate
                  attributeName="r"
                  values="6;10;6"
                  dur="2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.6;1;0.6"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          </motion.div>

          {/* Access Message */}
          <motion.div
            className="text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.2 }}
          >
            <p className="text-sm text-muted-foreground mb-4">
              [ AUTHENTICATION REQUIRED ]
            </p>
            <Button
              size="lg"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => navigate("/login")}
            >
              <LogIn className="w-5 h-5 mr-2" />
              Access System
            </Button>
          </motion.div>
        </motion.div>
      </section>

      {/* Corner Decorations */}
      <div className="absolute top-8 left-8 w-16 h-16 border-l-2 border-t-2 border-primary/50" />
      <div className="absolute top-8 right-8 w-16 h-16 border-r-2 border-t-2 border-primary/50" />
      <div className="absolute bottom-8 left-8 w-16 h-16 border-l-2 border-b-2 border-primary/50" />
      <div className="absolute bottom-8 right-8 w-16 h-16 border-r-2 border-b-2 border-primary/50" />
    </div>
  );
}
