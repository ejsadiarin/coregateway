// AWS icon sprite for coredraw (ticket 06).
//
// LICENSE POSTURE — read before swapping art:
// The official AWS Architecture Icons ZIP (aws.amazon.com/architecture/icons)
// grants a narrow license: customers/partners may use the icons in diagrams
// and materials, not blanket redistribution. That set is NOT vendored here,
// so this repo ships zero Amazon-owned bytes. The glyphs below are original
// stroke-style placeholders drawn for coredraw (personal/internal use) that
// hold the catalog seam open. To adopt the official set later, replace the
// `art` bodies in AWS_ICON_ART with the downloaded SVGs (pin the pack's
// stamp date, keep brand colors unmodified) and re-check the license if
// coredraw ever goes public.
//
// SPRITE MODEL: one TS module bundled with the lazy draw chunk — a single
// delivery unit, not one asset per icon. Snapshots stay lean: only `iconId`
// (a string) persists in shape props; the SVG bytes never touch the snapshot.

import type { ReactElement } from "react";
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

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface AwsIconEntry {
  id: string;
  title: string;
  keywords: string[];
}

export const AWS_ICON_CATALOG: AwsIconEntry[] = [
  { id: "aws-ec2", title: "EC2", keywords: ["elastic", "compute", "server", "vm", "instance"] },
  { id: "aws-s3", title: "S3", keywords: ["storage", "bucket", "object"] },
  { id: "aws-lambda", title: "Lambda", keywords: ["serverless", "function", "faas"] },
  { id: "aws-rds", title: "RDS", keywords: ["database", "relational", "postgres", "mysql", "sql"] },
  { id: "aws-dynamodb", title: "DynamoDB", keywords: ["database", "nosql", "key-value", "kv"] },
  { id: "aws-sqs", title: "SQS", keywords: ["queue", "messaging", "message"] },
  { id: "aws-sns", title: "SNS", keywords: ["notification", "pubsub", "pub-sub", "topic"] },
  { id: "aws-apigateway", title: "API Gateway", keywords: ["api", "gateway", "rest", "http"] },
  { id: "aws-cloudfront", title: "CloudFront", keywords: ["cdn", "edge", "cache", "distribution"] },
  { id: "aws-vpc", title: "VPC", keywords: ["network", "subnet", "virtual", "private", "cloud"] },
  { id: "aws-iam", title: "IAM", keywords: ["identity", "access", "user", "role", "key", "auth"] },
  { id: "aws-cloudwatch", title: "CloudWatch", keywords: ["monitoring", "metrics", "logs", "alarm"] },
];

export const AWS_ICON_IDS = new Set(AWS_ICON_CATALOG.map((e) => e.id));

// ---------------------------------------------------------------------------
// Sprite art (viewBox 0 0 48 48, stroke style). Original placeholders.
// ---------------------------------------------------------------------------

function Frame({ children }: { children: ReactElement | ReactElement[] }) {
  return (
    <>
      <rect x="4" y="4" width="40" height="40" rx="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </>
  );
}

function artFor(id: string): ReactElement {
  switch (id) {
    case "aws-ec2":
      return (
        <Frame>
          <rect x="14" y="16" width="20" height="16" />
          <path d="M14 22h20M20 16v16M28 16v16" />
        </Frame>
      );
    case "aws-s3":
      return (
        <Frame>
          <path d="M14 18h20v12H14z" />
          <path d="M14 22h20M18 18v12" />
          <circle cx="21.5" cy="25.5" r="1" fill="currentColor" />
        </Frame>
      );
    case "aws-lambda":
      return (
        <Frame>
          <path d="M27 13l-9 22M27 13l-2 8h7M18 27h8" />
        </Frame>
      );
    case "aws-rds":
      return (
        <Frame>
          <ellipse cx="24" cy="17" rx="9" ry="3.5" />
          <path d="M15 17v14c0 2 4 3.5 9 3.5s9-1.5 9-3.5V17M15 24c0 2 4 3.5 9 3.5s9-1.5 9-3.5" />
        </Frame>
      );
    case "aws-dynamodb":
      return (
        <Frame>
          <path d="M26 13l-8 13h6l-2 9 8-13h-6z" />
        </Frame>
      );
    case "aws-sqs":
      return (
        <Frame>
          <path d="M14 19h14M14 24h20M14 29h14" />
          <path d="M30 32l4 3-4 3" />
        </Frame>
      );
    case "aws-sns":
      return (
        <Frame>
          <circle cx="24" cy="27" r="3" />
          <path d="M17 22a10 10 0 0 1 14 0M14 18a15 15 0 0 1 20 0" />
          <path d="M24 13v3" />
        </Frame>
      );
    case "aws-apigateway":
      return (
        <Frame>
          <path d="M14 30h20" />
          <path d="M18 30v-6l6-6 6 6v6" />
          <circle cx="24" cy="14" r="1.6" fill="currentColor" />
        </Frame>
      );
    case "aws-cloudfront":
      return (
        <Frame>
          <circle cx="24" cy="24" r="9" />
          <path d="M15 24h18M24 15c-5 5-5 13 0 18M24 15c5 5 5 13 0 18" />
        </Frame>
      );
    case "aws-vpc":
      return (
        <Frame>
          <rect x="13" y="13" width="22" height="22" strokeDasharray="4 3" />
          <circle cx="19" cy="20" r="1.6" fill="currentColor" />
          <circle cx="29" cy="20" r="1.6" fill="currentColor" />
          <circle cx="24" cy="29" r="1.6" fill="currentColor" />
          <path d="M19 20l5 9 5-9" />
        </Frame>
      );
    case "aws-iam":
      return (
        <Frame>
          <circle cx="24" cy="20" r="5" />
          <path d="M15 33c1-5 5-7 9-7s8 2 9 7" />
        </Frame>
      );
    case "aws-cloudwatch":
      return (
        <Frame>
          <circle cx="24" cy="24" r="10" />
          <path d="M24 19v5l4 3" />
        </Frame>
      );
    default:
      // Forward-compat fallback: a snapshot referencing an iconId this client
      // doesn't know (newer catalog) still renders a visible box, not nothing.
      return (
        <Frame>
          <path d="M17 17h14v14H17z" />
          <path d="M17 25l5-5 4 4 3-3 2 2" />
        </Frame>
      );
  }
}

export function titleFor(iconId: string): string {
  return AWS_ICON_CATALOG.find((e) => e.id === iconId)?.title ?? iconId;
}

function artKeyFor(iconId: string): string {
  return AWS_ICON_IDS.has(iconId) ? iconId : "unknown";
}

export function AwsIconSvg({ iconId, label }: { iconId: string; label: string }): ReactElement {
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" role="img" aria-label={label}>
      {artFor(artKeyFor(iconId))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shape: one `aws-icon` type, `iconId` prop. Selectable, resizable,
// arrow-bindable (box geometry), JSON-serializable (props are w/h/iconId only).
// ---------------------------------------------------------------------------

// Shape-type registration (per the tldraw custom-shapes guide): augmenting
// TLGlobalShapePropsMap makes TLShape<'aws-icon'> resolve, so createShape,
// getShape, and the store validators all accept the custom type.

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    "aws-icon": { w: number; h: number; iconId: string };
  }
}

export type AwsIconShape = TLShape<"aws-icon">;

export class AwsIconUtil extends ShapeUtil<AwsIconShape> {
  static override type = "aws-icon" as const;
  static override props = { w: T.number, h: T.number, iconId: T.string };

  override getDefaultProps(): AwsIconShape["props"] {
    return { w: 96, h: 96, iconId: "aws-ec2" };
  }

  override getGeometry(shape: AwsIconShape) {
    // Box geometry: selectable, and arrows can bind to the icon.
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }

  override getIndicatorPath(shape: AwsIconShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override onResize(shape: AwsIconShape, info: TLResizeInfo<AwsIconShape>) {
    const resized = resizeBox(shape, info);
    // Keep icons square: grow along the dominant axis.
    const size = Math.max(resized.props.w, resized.props.h);
    return { ...resized, props: { ...resized.props, w: size, h: size } };
  }

  override component(shape: AwsIconShape) {
    const title = titleFor(shape.props.iconId);
    return (
      <HTMLContainer>
        <div style={{ width: shape.props.w, height: shape.props.h, color: "var(--color-foreground, #232f3e)" }}>
          <AwsIconSvg iconId={shape.props.iconId} label={title} />
        </div>
      </HTMLContainer>
    );
  }

  override toSvg(shape: AwsIconShape) {
    const title = titleFor(shape.props.iconId);
    return (
      <svg width={shape.props.w} height={shape.props.h} viewBox="0 0 48 48" role="img" aria-label={title}>
        {artFor(artKeyFor(shape.props.iconId))}
      </svg>
    );
  }
}

export const AWS_SHAPE_UTILS = [AwsIconUtil];

// ---------------------------------------------------------------------------
// Insertion helper (viewport-centered, selects the new shape).
// ---------------------------------------------------------------------------

export function insertAwsIcon(editor: Editor, iconId: string): void {
  const vp = editor.getViewportPageBounds();
  const id: TLShapeId = createShapeId();
  editor.createShape<AwsIconShape>({
    id,
    type: "aws-icon",
    x: vp.x + vp.w / 2 - 48,
    y: vp.y + vp.h / 2 - 48,
    props: { w: 96, h: 96, iconId },
  });
  editor.setSelectedShapes([id]);
}
