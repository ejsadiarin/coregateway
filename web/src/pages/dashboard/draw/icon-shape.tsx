// The `icon` shape: a vendored SVG with a caption underneath (ticket 06,
// generalised from the AWS-only sprite).
//
// Snapshots stay lean — only `iconId` (a string) and the caption text persist.
// The SVG bytes live in icon-sprite.generated.ts and ride the lazy draw chunk.

import type { CSSProperties, ReactElement } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  createShapeId,
  resizeBox,
  type Editor,
  type TLShape,
  type TLShapeId,
  type TLResizeInfo,
} from "tldraw";
import { iconSprite, iconTitle } from "@/pages/dashboard/draw/icon-catalog";

export const ICON_DEFAULT_W = 100;
export const ICON_DEFAULT_H = 126;

// ---------------------------------------------------------------------------
// Glyph — shared by the shape, the palette grid, and previews.
// ---------------------------------------------------------------------------

export function IconGlyph({
  iconId,
  label,
  style,
}: {
  iconId: string;
  label?: string;
  style?: CSSProperties;
}): ReactElement {
  const sprite = iconSprite(iconId);
  return (
    <svg
      viewBox={sprite.viewBox}
      width="100%"
      height="100%"
      role="img"
      aria-label={label ?? iconTitle(iconId)}
      // Coloured families (logos) carry their own fills and ignore this;
      // monochrome families (mdi) inherit currentColor so they stay legible
      // on both light canvas and dark panel.
      fill="currentColor"
      style={style}
      // Sprite bodies are generated from Iconify and committed — trusted
      // markup, never user input.
      dangerouslySetInnerHTML={{ __html: sprite.body }}
    />
  );
}

function captionFontSize(w: number): number {
  return Math.max(9, Math.min(15, Math.round(w / 8)));
}

// ---------------------------------------------------------------------------
// Shape registration
// ---------------------------------------------------------------------------

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    icon: { w: number; h: number; iconId: string; label: string };
    // Legacy type kept so boards made before the generic icon still load.
    "aws-icon": { w: number; h: number; iconId: string };
  }
}

export type IconShape = TLShape<"icon">;
export type LegacyAwsIconShape = TLShape<"aws-icon">;

function IconBody({
  w,
  h,
  iconId,
  label,
}: {
  w: number;
  h: number;
  iconId: string;
  label: string;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        overflow: "hidden",
        color: "var(--color-foreground, #232f3e)",
      }}
    >
      <div
        style={{
          flex: "1 1 auto",
          width: "100%",
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconGlyph iconId={iconId} label={label} />
      </div>
      {label && (
        <div
          style={{
            flex: "0 0 auto",
            maxWidth: "100%",
            padding: "0 2px",
            fontSize: captionFontSize(w),
            lineHeight: 1.15,
            textAlign: "center",
            fontFamily: "var(--font-sans, ui-sans-serif, system-ui)",
            color: "var(--color-foreground, #232f3e)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

export class IconUtil extends ShapeUtil<IconShape> {
  static override type = "icon" as const;
  static override props = { w: T.number, h: T.number, iconId: T.string, label: T.string };

  override getDefaultProps(): IconShape["props"] {
    return { w: ICON_DEFAULT_W, h: ICON_DEFAULT_H, iconId: "logos:aws-lambda", label: "Lambda" };
  }

  override getGeometry(shape: IconShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: IconShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override onResize(shape: IconShape, info: TLResizeInfo<IconShape>) {
    return resizeBox(shape, info);
  }

  override component(shape: IconShape) {
    const label = shape.props.label || iconTitle(shape.props.iconId);
    return (
      <HTMLContainer>
        <IconBody w={shape.props.w} h={shape.props.h} iconId={shape.props.iconId} label={label} />
      </HTMLContainer>
    );
  }

  override toSvg(shape: IconShape) {
    const label = shape.props.label || iconTitle(shape.props.iconId);
    const sprite = iconSprite(shape.props.iconId);
    const { w, h } = shape.props;
    const labelH = label ? captionFontSize(w) + 8 : 0;
    return (
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
        <svg
          x={0}
          y={0}
          width={w}
          height={h - labelH}
          viewBox={sprite.viewBox}
          preserveAspectRatio="xMidYMid meet"
          dangerouslySetInnerHTML={{ __html: sprite.body }}
        />
        {label && (
          <text
            x={w / 2}
            y={h - 3}
            textAnchor="middle"
            fontSize={captionFontSize(w)}
            fontFamily="ui-sans-serif, system-ui"
            fill="#232f3e"
          >
            {label}
          </text>
        )}
      </svg>
    );
  }
}

// Loads boards drawn with the old AWS-only shape: same rendering, no label
// prop (falls back to the catalog title).
export class LegacyAwsIconUtil extends ShapeUtil<LegacyAwsIconShape> {
  static override type = "aws-icon" as const;
  static override props = { w: T.number, h: T.number, iconId: T.string };

  override getDefaultProps(): LegacyAwsIconShape["props"] {
    return { w: 96, h: 96, iconId: "aws-ec2" };
  }

  override getGeometry(shape: LegacyAwsIconShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: LegacyAwsIconShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override component(shape: LegacyAwsIconShape) {
    const label = iconTitle(shape.props.iconId);
    // Old default was square with no caption; leave a little room for one.
    return (
      <HTMLContainer>
        <IconBody w={shape.props.w} h={shape.props.h} iconId={shape.props.iconId} label={label} />
      </HTMLContainer>
    );
  }

  override toSvg(shape: LegacyAwsIconShape) {
    const label = iconTitle(shape.props.iconId);
    const sprite = iconSprite(shape.props.iconId);
    return (
      <svg
        width={shape.props.w}
        height={shape.props.h}
        viewBox={sprite.viewBox}
        role="img"
        aria-label={label}
        dangerouslySetInnerHTML={{ __html: sprite.body }}
      />
    );
  }
}

export const ICON_SHAPE_UTILS = [IconUtil, LegacyAwsIconUtil];

// ---------------------------------------------------------------------------
// Insertion — viewport-centered, selects the new shape.
// ---------------------------------------------------------------------------

export function insertIcon(editor: Editor, iconId: string, title?: string): void {
  const vp = editor.getViewportPageBounds();
  const id: TLShapeId = createShapeId();
  editor.createShape<IconShape>({
    id,
    type: "icon",
    x: vp.x + vp.w / 2 - ICON_DEFAULT_W / 2,
    y: vp.y + vp.h / 2 - ICON_DEFAULT_H / 2,
    props: {
      w: ICON_DEFAULT_W,
      h: ICON_DEFAULT_H,
      iconId,
      label: title ?? iconTitle(iconId),
    },
  });
  editor.setSelectedShapes([id]);
}
