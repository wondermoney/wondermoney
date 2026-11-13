import { Link, Text } from "react-email";

/**
 * The action link written out under the button, for mail clients that drop buttons, then the
 * notes that close the email (what to do if it was not expected).
 */
export function LinkFallback({ label, url, notes }: { label: string; url: string; notes: string[] }) {
  return (
    <>
      <Text className="m-0 font-sans text-[13px] leading-[20px] text-[#6b7280]">{label}</Text>
      <Text className="m-0 mt-[4px] break-all font-sans text-[13px] leading-[20px]">
        <Link href={url} className="text-[#7c3aed] underline">
          {url}
        </Link>
      </Text>
      {notes.map((note) => (
        <Text key={note} className="m-0 mt-[14px] font-sans text-[13px] leading-[20px] text-[#6b7280]">
          {note}
        </Text>
      ))}
    </>
  );
}
