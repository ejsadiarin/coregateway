// Ready-made diagrams for the Shapes palette. Each template is a horizontal
// chain of icon + label pairs joined by arrows, built from the same engine
// factories as manually inserted elements, so nothing here is a special case
// on the canvas.

import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { buildArrow, buildIconInsertion, ICON_SIZE } from "@/pages/dashboard/draw/engine";

export interface DiagramTemplate {
  id: string;
  title: string;
  description: string;
  // Used by the palette to render a tiny preview row.
  icons: readonly string[];
  build: (x: number, y: number) => { elements: ExcalidrawElement[]; files: BinaryFiles };
}

// Wide enough that the label under one glyph never runs into the next glyph's
// label (labels are sized to their title, not clamped to the glyph width).
const GAP = 140;

function horizontalChain(icons: readonly string[]) {
  return (x: number, y: number) => {
    const elements: ExcalidrawElement[] = [];
    const files: BinaryFiles = {};
    for (let i = 0; i < icons.length; i++) {
      const left = x + i * (ICON_SIZE + GAP);
      const insertion = buildIconInsertion(icons[i], left, y);
      elements.push(...insertion.elements);
      files[insertion.file.id] = insertion.file;
      if (i > 0) {
        const prevRight = x + (i - 1) * (ICON_SIZE + GAP) + ICON_SIZE;
        elements.push(
          buildArrow(
            { x: prevRight + 10, y: y + ICON_SIZE / 2 },
            { x: left - 10, y: y + ICON_SIZE / 2 },
          ),
        );
      }
    }
    return { elements, files };
  };
}

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  {
    id: "serverless-api",
    title: "Serverless API",
    description: "Edge · API · function · table",
    icons: ["logos:aws-cloudfront", "logos:aws-api-gateway", "logos:aws-lambda", "logos:aws-dynamodb"],
    build: horizontalChain([
      "logos:aws-cloudfront",
      "logos:aws-api-gateway",
      "logos:aws-lambda",
      "logos:aws-dynamodb",
    ]),
  },
  {
    id: "ci-cd",
    title: "CI/CD pipeline",
    description: "Commit · build · deploy · run",
    icons: ["logos:aws-codecommit", "logos:aws-codebuild", "logos:aws-codedeploy", "logos:aws-ecs"],
    build: horizontalChain([
      "logos:aws-codecommit",
      "logos:aws-codebuild",
      "logos:aws-codedeploy",
      "logos:aws-ecs",
    ]),
  },
  {
    id: "event-pipeline",
    title: "Event pipeline",
    description: "Topic · queue · worker · bucket",
    icons: ["logos:aws-sns", "logos:aws-sqs", "logos:aws-lambda", "logos:aws-s3"],
    build: horizontalChain([
      "logos:aws-sns",
      "logos:aws-sqs",
      "logos:aws-lambda",
      "logos:aws-s3",
    ]),
  },
  {
    id: "kubernetes-stack",
    title: "Kubernetes stack",
    description: "Image · cluster · package · metrics",
    icons: ["logos:docker-icon", "logos:kubernetes", "logos:helm", "logos:prometheus"],
    build: horizontalChain([
      "logos:docker-icon",
      "logos:kubernetes",
      "logos:helm",
      "logos:prometheus",
    ]),
  },
];

export function diagramTemplate(id: string): DiagramTemplate | undefined {
  return DIAGRAM_TEMPLATES.find((template) => template.id === id);
}

// Build the template centred on (centerX, centerY), matching how icons and
// shapes drop at the viewport centre.
export function buildDiagramTemplate(
  id: string,
  centerX: number,
  centerY: number,
): { elements: ExcalidrawElement[]; files: BinaryFiles } | null {
  const template = diagramTemplate(id);
  if (!template) return null;
  const width = template.icons.length * (ICON_SIZE + GAP) - GAP;
  return template.build(centerX - width / 2, centerY - ICON_SIZE / 2);
}
