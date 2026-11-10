import { useEffect, useState } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { cn } from "@/lib/utils";
import { Badge } from "../ui/badge";

interface Props {
  tabs: {
    title: string;
    description: string;
    image: string;
    soon?: boolean;
  }[];
  order?: "image-first" | "text-first";
}

export function TabsWithImages({ tabs, order = "text-first" }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tabOrientation, setTabOrientation] = useState<
    "horizontal" | "vertical"
  >("horizontal");

  useEffect(() => {
    const lgMediaQuery = window.matchMedia("(min-width: 1024px)");

    function onMediaQueryChange({ matches }: { matches: boolean }) {
      setTabOrientation(matches ? "vertical" : "horizontal");
    }

    onMediaQueryChange(lgMediaQuery);
    lgMediaQuery.addEventListener("change", onMediaQueryChange);

    return () => {
      lgMediaQuery.removeEventListener("change", onMediaQueryChange);
    };
  }, []);

  return (
    <TabGroup
      selectedIndex={selectedIndex}
      onChange={setSelectedIndex}
      className="grid grid-flow-row lg:grid-flow-col grid-cols-1 items-center gap-8 sm:gap-y-6 lg:grid-cols-2"
      vertical={tabOrientation === "vertical"}
    >
      <div
        className={cn(
          "-mx-4 flex overflow-x-auto pb-4 sm:mx-0 sm:overflow-visible sm:pb-0",
          {
            "lg:col-start-1": order === "text-first",
            "lg:col-start-2": order === "image-first",
          }
        )}
      >
        <TabList className="relative z-10 flex gap-x-4 whitespace-nowrap mx-4 lg:mx-0 lg:flex-col lg:gap-x-0 lg:gap-y-2 lg:whitespace-normal">
          {tabs.map((tab) => (
            <Tab
              key={tab.title}
              className={cn(
                "group relative lg:px-4 lg:py-1 rounded-md lg:rounded-card lg:p-6 transition-colors hover:bg-accent cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-left w-full ui-selected:bg-accent",
                "ring-1 ring-inset ring-border"
              )}
            >
              <h3>
                <div className="text-foreground font-semibold py-4 px-6 lg:p-0 w-full flex items-center gap-2">
                  {tab.title}
                  {tab.soon && <Badge variant="secondary">Soon</Badge>}
                </div>
              </h3>
              <p className="mt-4 hidden text-sm lg:block text-foreground">
                {tab.description}
              </p>
            </Tab>
          ))}
        </TabList>
      </div>
      <TabPanels
        className={cn({
          "lg:col-start-1": order === "image-first",
          "lg:col-start-2": order === "text-first",
        })}
      >
        {tabs.map((tab) => (
          <TabPanel key={tab.title} unmount={false}>
            <div className="relative lg:hidden">
              <div className="absolute -inset-x-4 bottom-[-4.25rem] top-[-6.5rem] bg-paper-2 ring-1 ring-inset ring-border sm:inset-x-0 sm:rounded-t-xl" />
              <p className="relative mx-auto max-w-2xl text-base text-muted-foreground">
                {tab.description}
              </p>
            </div>
            <div className="mt-10 overflow-hidden rounded-xl sm:w-auto lg:mt-0">
              <img
                className="w-full h-[400px] object-contain"
                src={tab.image}
                alt={`${tab.title} illustration`}
              />
            </div>
          </TabPanel>
        ))}
      </TabPanels>
    </TabGroup>
  );
}
