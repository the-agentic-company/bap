import { XIcon } from "lucide-react";
import * as React from "react";
import {
  Sheet as SheetPrimitive,
  SheetOverlay as SheetOverlayPrimitive,
  SheetClose as SheetClosePrimitive,
  SheetPortal as SheetPortalPrimitive,
  SheetContent as SheetContentPrimitive,
  SheetTitle as SheetTitlePrimitive,
  SheetDescription as SheetDescriptionPrimitive,
  type SheetProps as SheetPrimitiveProps,
  type SheetOverlayProps as SheetOverlayPrimitiveProps,
  type SheetCloseProps as SheetClosePrimitiveProps,
  type SheetContentProps as SheetContentPrimitiveProps,
} from "@/components/animate-ui/primitives/radix/sheet";
import { cn } from "@/lib/utils";

type SheetProps = SheetPrimitiveProps;

function Sheet(props: SheetProps) {
  return <SheetPrimitive {...props} />;
}

type SheetOverlayProps = SheetOverlayPrimitiveProps;

function SheetOverlay({ className, ...props }: SheetOverlayProps) {
  return (
    <SheetOverlayPrimitive className={cn("fixed inset-0 z-50 bg-black/50", className)} {...props} />
  );
}

type SheetCloseProps = SheetClosePrimitiveProps;

function SheetClose(props: SheetCloseProps) {
  return <SheetClosePrimitive {...props} />;
}

type SheetContentProps = SheetContentPrimitiveProps & {
  showCloseButton?: boolean;
  title?: string;
  description?: string;
};

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  title = "Sheet",
  description,
  ...props
}: SheetContentProps) {
  return (
    <SheetPortalPrimitive>
      <SheetOverlay />
      <SheetContentPrimitive
        className={cn(
          "bg-background fixed z-50 flex flex-col gap-4 shadow-lg",
          side === "right" && "h-full w-[350px] border-l",
          side === "left" && "h-full w-[350px] border-r",
          side === "top" && "w-full h-[350px] border-b",
          side === "bottom" && "w-full h-[350px] border-t",
          className,
        )}
        side={side}
        {...(!description && { "aria-describedby": undefined })}
        {...props}
      >
        <SheetTitlePrimitive className="sr-only">{title}</SheetTitlePrimitive>
        {description && (
          <SheetDescriptionPrimitive className="sr-only">{description}</SheetDescriptionPrimitive>
        )}
        {children}
        {showCloseButton && (
          <SheetClose className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetClose>
        )}
      </SheetContentPrimitive>
    </SheetPortalPrimitive>
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  type SheetProps,
  type SheetCloseProps,
  type SheetContentProps,
};
