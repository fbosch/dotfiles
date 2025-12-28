import {
  Action,
  ActionPanel,
  Form,
  Icon,
  showToast,
  Toast,
} from "@vicinae/api";
import { useState } from "react";

interface OpacityResult {
  percentage: number;
  decimal: number;
  hex: string;
  description: string;
}

function generateOpacityTable(): OpacityResult[] {
  const results: OpacityResult[] = [];
  
  // Generate 0-100 in steps of 1
  for (let i = 0; i <= 100; i++) {
    const decimal = i / 100;
    const alpha = Math.round(decimal * 255);
    const hex = alpha.toString(16).padStart(2, "0").toUpperCase();
    
    results.push({
      percentage: i,
      decimal: Number(decimal.toFixed(2)),
      hex,
      description: `${i}% opacity`,
    });
  }
  
  return results;
}

const OPACITY_TABLE = generateOpacityTable();

export default function HexOpacity() {
  const [opacityInput, setOpacityInput] = useState("");
  const [selectedResult, setSelectedResult] = useState<OpacityResult | null>(null);

  const handleOpacityChange = (value: string) => {
    setOpacityInput(value);
    
    // Try to parse the input
    const num = Number.parseFloat(value);
    
    if (Number.isNaN(num) || num < 0 || num > 100) {
      setSelectedResult(null);
      return;
    }
    
    // Find exact match or closest match
    const rounded = Math.round(num);
    const result = OPACITY_TABLE.find(r => r.percentage === rounded);
    
    if (result) {
      setSelectedResult(result);
    }
  };

  return (
    <Form
      actions={
        <ActionPanel>
          {selectedResult && (
            <ActionPanel.Section>
              <Action.CopyToClipboard
                title="Copy Hex Value"
                content={selectedResult.hex}
                icon={Icon.CopyClipboard}
                onCopy={async () => {
                  await showToast({
                    style: Toast.Style.Success,
                    title: "Copied Hex",
                    message: selectedResult.hex,
                  });
                }}
              />
              <Action.CopyToClipboard
                title="Copy with Hash"
                content={`#${selectedResult.hex}`}
                icon={Icon.CopyClipboard}
                onCopy={async () => {
                  await showToast({
                    style: Toast.Style.Success,
                    title: "Copied",
                    message: `#${selectedResult.hex}`,
                  });
                }}
              />
              <Action.CopyToClipboard
                title="Copy Decimal"
                content={String(selectedResult.decimal)}
                icon={Icon.CopyClipboard}
                onCopy={async () => {
                  await showToast({
                    style: Toast.Style.Success,
                    title: "Copied Decimal",
                    message: String(selectedResult.decimal),
                  });
                }}
              />
            </ActionPanel.Section>
          )}
          <ActionPanel.Section title="Quick Reference">
            {[100, 95, 90, 85, 80, 75, 70, 60, 50, 40, 30, 25, 20, 10, 5, 0].map((percentage) => {
              const result = OPACITY_TABLE[percentage];
              return (
                <Action.CopyToClipboard
                  key={percentage}
                  title={`${percentage}% = ${result.hex}`}
                  content={result.hex}
                  icon={Icon.CopyClipboard}
                  onCopy={async () => {
                    await showToast({
                      style: Toast.Style.Success,
                      title: `Copied ${percentage}%`,
                      message: result.hex,
                    });
                  }}
                />
              );
            })}
          </ActionPanel.Section>
        </ActionPanel>
      }
    >
      <Form.TextField
        id="opacity"
        title="Opacity Percentage"
        placeholder="Enter 0-100 (e.g., 20, 50, 75)"
        value={opacityInput}
        onChange={handleOpacityChange}
        info="Enter an opacity percentage between 0-100 to get the hex alpha value"
      />
      
      {selectedResult && (
        <>
          <Form.Separator />
          <Form.Description
            title="Hex Alpha"
            text={selectedResult.hex}
          />
          <Form.Description
            title="Decimal"
            text={String(selectedResult.decimal)}
          />
          <Form.Description
            title="Usage"
            text={`Add to end of hex color: #RRGGBB${selectedResult.hex}`}
          />
          <Form.Separator />
          <Form.Description
            title="Examples"
            text={`#FF0000${selectedResult.hex} (red at ${selectedResult.percentage}%)\n#00FF00${selectedResult.hex} (green at ${selectedResult.percentage}%)\n#0000FF${selectedResult.hex} (blue at ${selectedResult.percentage}%)`}
          />
        </>
      )}
    </Form>
  );
}
