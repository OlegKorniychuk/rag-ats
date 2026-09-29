import { useState, type ReactNode } from 'react';
import { Autocomplete, TextField } from '@mui/material';

interface ChipInputProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  onBlur?: () => void;
  error?: boolean;
  helperText?: ReactNode;
  placeholder?: string;
}

function normalize(values: string[]): string[] {
  const result: string[] = [];
  for (const raw of values) {
    const trimmed = raw.trim();
    if (trimmed && !result.includes(trimmed)) {
      result.push(trimmed);
    }
  }
  return result;
}

export function ChipInput({
  label,
  value,
  onChange,
  onBlur,
  error,
  helperText,
  placeholder,
}: ChipInputProps) {
  const [inputValue, setInputValue] = useState('');

  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect
      options={[]}
      value={value}
      inputValue={inputValue}
      onChange={(_event, newValue) => {
        onChange(normalize(newValue as string[]));
        setInputValue('');
      }}
      onInputChange={(_event, newInputValue, reason) => {
        if (reason !== 'input' || !newInputValue.includes(',')) {
          setInputValue(newInputValue);
          return;
        }
        const parts = newInputValue.split(',');
        const merged = normalize([...value, ...parts.slice(0, -1)]);
        if (merged.length !== value.length) {
          onChange(merged);
        }
        setInputValue(parts[parts.length - 1]);
      }}
      onBlur={onBlur}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          error={error}
          helperText={helperText}
        />
      )}
    />
  );
}
