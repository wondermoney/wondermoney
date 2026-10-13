"use client";

import { Landmark } from "lucide-react";
import Image from "next/image";

import { Text } from "@/components/ui/Typography";

import { Button } from "../ui/button";

interface BankListProps {
  // `logo` is nullable per the Enable Banking contract — not every institution
  // Enable Banking returns has one, unlike GoCardless which always did.
  bankList: { id: string; logo: string | null; name: string }[];
  onClick: (id: string) => void;
}

const BankList: React.FC<BankListProps> = ({ bankList, onClick }) => {
  return (
    <div className="overflow-y-auto">
      <ul className="grid max-h-[500px] grid-cols-1 gap-2 md:grid-cols-2 md:gap-4">
        {bankList.map((b) => (
          <li key={b.id}>
            <Button
              // className="flex w-full items-center justify-start gap-6 py-2 shadow-xs"
              className="size-full justify-start gap-2"
              variant="secondary"
              onClick={() => {
                onClick(b.id);
              }}
              title={b.name}
            >
              <div className="relative size-10">
                {b.logo ? (
                  <Image
                    src={b.logo}
                    alt={b.name}
                    fill
                    style={{
                      objectFit: "contain",
                      borderRadius: "9999px",
                    }}
                    loading="lazy"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full"
                  >
                    <Landmark className="size-5" />
                  </div>
                )}
              </div>
              <Text
                variant="smallText"
                className="flex-1 text-left whitespace-break-spaces"
              >
                {b.name}
              </Text>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default BankList;
