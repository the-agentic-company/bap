// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoworkerDocumentsPanel } from "./coworker-documents-panel";
import type { CoworkerDocumentRecord } from "./types";

void jestDomVitest;

afterEach(cleanup);

const EMPTY_DOCUMENT_IDS: string[] = [];

function createDocuments(count: number): CoworkerDocumentRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `document-${index}`,
    filename: `document-${index}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 100,
    description: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
}

function renderPanel(documentCount: number) {
  render(
    <CoworkerDocumentsPanel
      documents={createDocuments(documentCount)}
      isUploadingDocuments={false}
      deletingDocumentIds={EMPTY_DOCUMENT_IDS}
      downloadingDocumentIds={EMPTY_DOCUMENT_IDS}
      onUploadDocuments={vi.fn<(files: FileList | File[]) => void>()}
      onDownloadDocument={vi.fn<(document: CoworkerDocumentRecord) => void>()}
      onDeleteDocument={vi.fn<(document: CoworkerDocumentRecord) => void>()}
    />,
  );
}

describe("CoworkerDocumentsPanel document limit", () => {
  it("shows the current document count and maximum", () => {
    renderPanel(17);

    expect(screen.getByText("17 of 20 documents")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload coworker documents" })).toBeEnabled();
  });

  it("explains and disables uploads when the maximum is reached", () => {
    renderPanel(20);

    expect(screen.getByText("20 of 20 documents")).toBeInTheDocument();
    expect(screen.getByText("Maximum of 20 documents reached")).toBeInTheDocument();
    expect(screen.getByText("Document limit reached")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload coworker documents" })).toBeDisabled();
  });
});
