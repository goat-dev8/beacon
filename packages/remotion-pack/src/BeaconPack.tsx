import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type BeaconPackProps = {
  title: string;
  subtitle?: string;
};

export const BeaconPack: React.FC<BeaconPackProps> = ({
  title,
  subtitle = "Finished work. Paid only when it passes.",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps * 0.6], [0, 1], {
    extrapolateRight: "clamp",
  });
  const scale = interpolate(frame, [0, fps], [1, 1.04], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0B1220",
        color: "#E8EEF7",
        fontFamily: "Inter, system-ui, sans-serif",
        justifyContent: "center",
        alignItems: "center",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <div style={{ textAlign: "center", padding: 64, maxWidth: 900 }}>
        <div style={{ fontSize: 28, letterSpacing: 6, color: "#5B8CFF", marginBottom: 24 }}>
          BEACON
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.15 }}>{title}</div>
        <div style={{ fontSize: 24, marginTop: 28, color: "#9AA8BC" }}>{subtitle}</div>
      </div>
    </AbsoluteFill>
  );
};
