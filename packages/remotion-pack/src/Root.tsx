import "./index.css";
import { Composition } from "remotion";
import { BeaconPack } from "./BeaconPack";
import { MyComposition } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="BeaconPack"
        component={BeaconPack}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          title: "Finish AI work",
          subtitle: "Pay only when it passes.",
        }}
      />
      <MyComposition />
    </>
  );
};
