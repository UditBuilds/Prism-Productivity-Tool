"use client"

import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> & {
    /** Accent → transparent gradient instead of the flat border color */
    gradient?: boolean
  }
>(
  (
    {
      className,
      orientation = "horizontal",
      decorative = true,
      gradient = false,
      ...props
    },
    ref
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0",
        gradient
          ? orientation === "horizontal"
            ? "bg-gradient-to-r from-accent/40 via-accent/10 to-transparent"
            : "bg-gradient-to-b from-accent/40 via-accent/10 to-transparent"
          : "bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
