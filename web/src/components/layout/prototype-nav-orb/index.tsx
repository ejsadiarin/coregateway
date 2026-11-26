// PROTOTYPE (throwaway): the phone nav as a movable orb, in three variants,
// switchable via ?variant= on any dashboard page. Z is today's bottom bar
// for comparison. Throw the losers away once one wins.
import { MobileBottomNav } from "../mobile-bottom-nav";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import { useVariant } from "./shared";
import { VariantOrbit } from "./variant-orbit";
import { VariantDrum } from "./variant-drum";
import { VariantDial } from "./variant-dial";

export const navOrbVariants = [
  { key: "A", name: "Orbit — arc on threads" },
  { key: "B", name: "Drum — 3D picker" },
  { key: "C", name: "Dial — rotary ring" },
  { key: "Z", name: "Current bottom bar" },
];

export function useNavOrbVariant() {
  return useVariant();
}

export function NavOrbPrototype() {
  const variant = useVariant();
  return (
    <>
      {variant === "Z" ? (
        <MobileBottomNav />
      ) : (
        <div className="md:hidden">
          {variant === "A" && <VariantOrbit />}
          {variant === "B" && <VariantDrum />}
          {variant === "C" && <VariantDial />}
        </div>
      )}
      <PrototypeSwitcher variants={navOrbVariants} current={variant} />
    </>
  );
}
