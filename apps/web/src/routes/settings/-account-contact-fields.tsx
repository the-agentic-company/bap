import type { ITimezone } from "react-timezone-select";
import { Loader2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import TimezoneSelect from "react-timezone-select";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";

type AccountContactFieldsProps = {
  browserTimezone: string;
  isRemovingPhone: boolean;
  isSavingTimezone: boolean;
  onPhoneNumberChange: (value?: string) => void;
  onRemovePhoneNumber: () => void;
  onTimezoneChange: (value: string) => void;
  onUseBrowserTimezone: () => void;
  phoneNumber: string;
  timezoneDiffers: boolean;
  timezoneInput: string;
};

function useTimezoneSelectStyles() {
  return useMemo(
    () => ({
      control: (base: Record<string, unknown>, state: { isFocused: boolean }) => ({
        ...base,
        backgroundColor: "transparent",
        borderColor: state.isFocused ? "var(--color-ring)" : "var(--color-input)",
        borderRadius: "var(--radius-md)",
        minHeight: "36px",
        boxShadow: state.isFocused
          ? "0 0 0 3px color-mix(in oklab, var(--color-ring) 50%, transparent)"
          : "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        fontSize: "14px",
        "&:hover": {
          borderColor: state.isFocused ? "var(--color-ring)" : "var(--color-input)",
        },
      }),
      menu: (base: Record<string, unknown>) => ({
        ...base,
        backgroundColor: "var(--color-popover)",
        color: "var(--color-popover-foreground)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        zIndex: 50,
        overflow: "hidden",
      }),
      menuList: (base: Record<string, unknown>) => ({
        ...base,
        padding: "4px",
      }),
      option: (
        base: Record<string, unknown>,
        state: { isFocused: boolean; isSelected: boolean },
      ) => ({
        ...base,
        backgroundColor: state.isSelected
          ? "var(--color-accent)"
          : state.isFocused
            ? "var(--color-accent)"
            : "transparent",
        color: state.isSelected
          ? "var(--color-accent-foreground)"
          : state.isFocused
            ? "var(--color-accent-foreground)"
            : "var(--color-popover-foreground)",
        borderRadius: "var(--radius-sm)",
        fontSize: "14px",
        padding: "6px 8px",
        cursor: "pointer",
        "&:active": {
          backgroundColor: "var(--color-accent)",
        },
      }),
      singleValue: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-foreground)",
      }),
      input: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-foreground)",
      }),
      placeholder: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-muted-foreground)",
      }),
      indicatorSeparator: () => ({
        display: "none",
      }),
      dropdownIndicator: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-muted-foreground)",
        padding: "0 8px",
        "&:hover": {
          color: "var(--color-foreground)",
        },
      }),
      noOptionsMessage: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-muted-foreground)",
        fontSize: "14px",
      }),
    }),
    [],
  );
}

export default function AccountContactFields({
  browserTimezone,
  isRemovingPhone,
  isSavingTimezone,
  onPhoneNumberChange,
  onRemovePhoneNumber,
  onTimezoneChange,
  onUseBrowserTimezone,
  phoneNumber,
  timezoneDiffers,
  timezoneInput,
}: AccountContactFieldsProps) {
  const timezoneSelectStyles = useTimezoneSelectStyles();
  const handleTimezoneChange = useCallback(
    (tz: ITimezone) => {
      onTimezoneChange(typeof tz === "string" ? tz : tz.value);
    },
    [onTimezoneChange],
  );

  return (
    <>
      <div>
        <label className="mb-2 block text-sm font-medium">Phone number</label>
        <PhoneInput
          defaultCountry="US"
          international
          countryCallingCodeEditable={false}
          value={phoneNumber}
          onChange={onPhoneNumberChange}
          placeholder="Enter your phone number"
        />
        {phoneNumber ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onRemovePhoneNumber}
            disabled={isRemovingPhone}
          >
            {isRemovingPhone ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Removing...
              </>
            ) : (
              "Remove phone number"
            )}
          </Button>
        ) : null}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium">Timezone</label>
        <TimezoneSelect
          value={timezoneInput}
          onChange={handleTimezoneChange}
          styles={timezoneSelectStyles}
          placeholder="Select your timezone..."
        />
        {isSavingTimezone && (
          <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs">
            <Loader2 className="inline h-3 w-3 animate-spin" /> Saving...
          </p>
        )}
        {timezoneDiffers ? (
          <div className="mt-3 flex items-center gap-3 text-sm">
            <p className="text-muted-foreground">
              Browser detects <strong className="text-foreground">{browserTimezone}</strong>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onUseBrowserTimezone}
              disabled={isSavingTimezone}
            >
              Use browser timezone
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
