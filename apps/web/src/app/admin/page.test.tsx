// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

void jestDomVitest;

const {
  addApprovedLoginEntryMutateAsyncMock,
  removeApprovedLoginEntryMutateAsyncMock,
  addAllowlistEntryMutateAsyncMock,
  removeAllowlistEntryMutateAsyncMock,
  setUserAdminRoleMutateAsyncMock,
  grantAdminAccessByEmailMutateAsyncMock,
  addGalienAccessMutateAsyncMock,
  removeGalienAccessMutateAsyncMock,
  getSessionMock,
  listUsersMock,
} = vi.hoisted(() => ({
  addApprovedLoginEntryMutateAsyncMock: vi.fn(),
  removeApprovedLoginEntryMutateAsyncMock: vi.fn(),
  addAllowlistEntryMutateAsyncMock: vi.fn(),
  removeAllowlistEntryMutateAsyncMock: vi.fn(),
  setUserAdminRoleMutateAsyncMock: vi.fn(),
  grantAdminAccessByEmailMutateAsyncMock: vi.fn(),
  addGalienAccessMutateAsyncMock: vi.fn(),
  removeGalienAccessMutateAsyncMock: vi.fn(),
  getSessionMock: vi.fn(),
  listUsersMock: vi.fn(),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    type = "button",
    onClick,
    disabled,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/data-table", () => ({
  DataTable: ({
    columns,
    data,
  }: {
    columns: Array<{
      accessorKey?: string;
      id?: string;
      cell?: (props: { row: { original: Record<string, unknown> } }) => React.ReactNode;
    }>;
    data: Array<Record<string, unknown>>;
  }) => (
    <table>
      <tbody>
        {data.map((row) => (
          <tr key={String(row.email)}>
            {columns.map((column) => (
              <td key={String(column.id ?? column.accessorKey)}>
                {column.cell
                  ? column.cell({ row: { original: row } })
                  : String(row[column.accessorKey ?? ""] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: getSessionMock,
    admin: {
      listUsers: listUsersMock,
      impersonateUser: vi.fn(),
      stopImpersonating: vi.fn(),
    },
  },
}));

vi.mock("@/orpc/hooks", () => ({
  useApprovedLoginEmailAllowlist: () => ({
    data: [
      {
        id: "builtin:baptiste@heybap.com",
        email: "baptiste@heybap.com",
        createdByUserId: null,
        createdAt: null,
        isBuiltIn: true,
      },
    ],
    isLoading: false,
    error: null,
  }),
  useAddApprovedLoginEmailAllowlistEntry: () => ({
    mutateAsync: addApprovedLoginEntryMutateAsyncMock,
    isPending: false,
  }),
  useRemoveApprovedLoginEmailAllowlistEntry: () => ({
    mutateAsync: removeApprovedLoginEntryMutateAsyncMock,
    isPending: false,
  }),
  useGoogleAccessAllowlist: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
  useAddGoogleAccessAllowlistEntry: () => ({
    mutateAsync: addAllowlistEntryMutateAsyncMock,
    isPending: false,
  }),
  useRemoveGoogleAccessAllowlistEntry: () => ({
    mutateAsync: removeAllowlistEntryMutateAsyncMock,
    isPending: false,
  }),
  useSetUserAdminRole: () => ({
    mutateAsync: setUserAdminRoleMutateAsyncMock,
    isPending: false,
  }),
  useGrantAdminAccessByEmail: () => ({
    mutateAsync: grantAdminAccessByEmailMutateAsyncMock,
    isPending: false,
  }),
  useAdminWorkspaces: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
  useAdminGalienAccess: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
  useAdminAddGalienAccess: () => ({
    mutateAsync: addGalienAccessMutateAsyncMock,
    isPending: false,
  }),
  useAdminRemoveGalienAccess: () => ({
    mutateAsync: removeGalienAccessMutateAsyncMock,
    isPending: false,
  }),
}));

import AdminPage from "./page";

describe("AdminPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    listUsersMock.mockResolvedValue({ data: { users: [] } });
  });

  it("shows the invite-only waitlist emails", async () => {
    render(<AdminPage />);

    expect(screen.getByText("User Management")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("baptiste@heybap.com")).toBeInTheDocument();
    });
  });

  it("adds an approved login email", async () => {
    addApprovedLoginEntryMutateAsyncMock.mockResolvedValueOnce({
      id: "entry-1",
      email: "user@example.com",
      createdByUserId: "admin-1",
      createdAt: new Date(),
      isBuiltIn: false,
    });

    render(<AdminPage />);

    const addForm = screen.getByRole("button", { name: "Add" }).closest("form") as HTMLElement;
    fireEvent.change(within(addForm).getByPlaceholderText("user@company.com"), {
      target: { value: "User@Example.com " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(addApprovedLoginEntryMutateAsyncMock).toHaveBeenCalledWith({
        email: "user@example.com",
      });
    });
  });

  it("toggles admin access for another user", async () => {
    listUsersMock.mockResolvedValueOnce({
      data: {
        users: [
          {
            id: "user-2",
            email: "member@example.com",
            name: "Member",
            role: "user",
          },
        ],
      },
    });
    setUserAdminRoleMutateAsyncMock.mockResolvedValueOnce({
      id: "user-2",
      role: "admin",
    });

    render(<AdminPage />);

    const adminSwitch = await screen.findByLabelText("Admin access for member@example.com");
    fireEvent.click(adminSwitch);

    await waitFor(() => {
      expect(setUserAdminRoleMutateAsyncMock).toHaveBeenCalledWith({
        userId: "user-2",
        isAdmin: true,
      });
    });
  });

  it("does not show admin access in the add form", () => {
    render(<AdminPage />);

    const addForm = screen.getByRole("button", { name: "Add" }).closest("form") as HTMLElement;
    expect(within(addForm).getByRole("checkbox", { name: "Login" })).toBeInTheDocument();
    expect(within(addForm).getByRole("checkbox", { name: "Google" })).toBeInTheDocument();
    expect(within(addForm).queryByRole("checkbox", { name: "Admin" })).not.toBeInTheDocument();
  });
});
