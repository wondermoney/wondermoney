import { TextInput } from 'react-native'

/**
 * Test stand-in for `@/components/ui/date-field`: the real control is a native
 * picker, so screen tests swap in a text input with the same label and the same
 * ISO `YYYY-MM-DD` value contract.
 */
export function DateField({ label, value, onChange, disabled = false }: { label: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean }) {
  return <TextInput accessibilityLabel={label} editable={!disabled} value={value ?? ''} onChangeText={(next) => onChange(next || null)} />
}
