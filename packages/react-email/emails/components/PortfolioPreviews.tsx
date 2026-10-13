import {
  Column,
  Hr,
  Row,
  Section,
  Text,
} from "react-email";

const cardClass = "rounded-[10px] border border-solid border-[#e5e7eb] bg-white px-[20px] py-[18px]";
const labelClass = "m-0 font-sans text-[12px] leading-[18px] text-[#6b7280]";
const valueClass = "m-0 font-mono text-[15px] font-semibold leading-[22px] text-[#111111]";

function AllocationRow({
  label,
  amount,
  value,
  color = "#7c3aed",
}: {
  label: string;
  amount: string;
  value: string;
  color?: string;
}) {
  return (
    <Row>
      <Column style={{ paddingBottom: "9px", width: "18px" }}>
        <Text
          className="m-0 h-[10px] w-[10px] rounded-[2px] text-[0px] leading-[10px]"
          style={{ backgroundColor: color }}
        >
          &nbsp;
        </Text>
      </Column>
      <Column style={{ paddingBottom: "9px" }}>
        <Text className="m-0 font-sans text-[13px] leading-[20px] text-[#374151]">
          {label}
        </Text>
      </Column>
      <Column align="right" style={{ paddingBottom: "9px", width: "105px" }}>
        <Text className="m-0 font-mono text-[13px] leading-[20px] text-[#374151]">
          {amount}
        </Text>
      </Column>
      <Column align="right" style={{ paddingBottom: "9px", width: "48px" }}>
        <Text className="m-0 font-mono text-[13px] font-semibold leading-[20px] text-[#111111]">
          {value}
        </Text>
      </Column>
    </Row>
  );
}

export function PortfolioSnapshot() {
  return (
    <Section className={cardClass} aria-label="Resumo ilustrativo do portefólio">
      <Row>
        <Column>
          <Text className="m-0 font-sans text-[13px] font-medium leading-[20px] text-[#374151]">
            Visão consolidada
          </Text>
          <Text className="m-0 mt-[2px] font-sans text-[11px] leading-[16px] text-[#9ca3af]">
            3 portefólios · preços atualizados diariamente
          </Text>
        </Column>
        <Column align="right">
          <Text className="m-0 font-sans text-[10px] leading-[16px] text-[#9ca3af]">
            DADOS ILUSTRATIVOS
          </Text>
        </Column>
      </Row>
      <Hr className="my-[15px] border-[#f0f1f3]" />
      <Text className={labelClass}>Valor total</Text>
      <Text className="m-0 mt-[3px] font-mono text-[28px] font-semibold leading-[34px] text-[#111111]">
        €24.380,50
      </Text>
      <Row className="mt-[14px]">
        <Column>
          <Text className={labelClass}>Ganho/perda total</Text>
          <Text className="m-0 font-mono text-[14px] font-semibold leading-[21px] text-[#16803c]">
            +€2.700,50 · +12,4%
          </Text>
        </Column>
        <Column align="right">
          <Text className={labelClass}>Ano até à data</Text>
          <Text className="m-0 font-mono text-[14px] font-semibold leading-[21px] text-[#16803c]">
            +8,4%
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

export function ImportPreview() {
  return (
    <Section
      aria-label="Fluxo ilustrativo: valores de várias corretoras são organizados pela importação inteligente e apresentados numa visão de performance"
    >
      <Row>
        <Column style={{ verticalAlign: "middle", width: "42%" }}>
          <Text className="m-0 font-sans text-[10px] font-semibold leading-[15px] text-[#374151]">
            Várias corretoras
          </Text>
          <Row className="mt-[6px]">
            <Column>
              <Text className="m-0 font-sans text-[9px] leading-[15px] text-[#6b7280]">Corretora A</Text>
            </Column>
            <Column align="right">
              <Text className="m-0 font-mono text-[9px] leading-[15px] text-[#111111]">€11.702,64</Text>
            </Column>
          </Row>
          <Row>
            <Column>
              <Text className="m-0 font-sans text-[9px] leading-[15px] text-[#6b7280]">Corretora B</Text>
            </Column>
            <Column align="right">
              <Text className="m-0 font-mono text-[9px] leading-[15px] text-[#111111]">€7.801,76</Text>
            </Column>
          </Row>
          <Row>
            <Column>
              <Text className="m-0 font-sans text-[9px] leading-[15px] text-[#6b7280]">Corretora C</Text>
            </Column>
            <Column align="right">
              <Text className="m-0 font-mono text-[9px] leading-[15px] text-[#111111]">€4.876,10</Text>
            </Column>
          </Row>
        </Column>

        <Column align="center" style={{ verticalAlign: "middle", width: "16%" }}>
          <Text className="m-0 font-sans text-[8px] leading-[12px] text-[#6b7280]">
            Organizar
          </Text>
          <Text className="m-0 font-sans text-[19px] leading-[22px] text-[#7c3aed]">
            →
          </Text>
        </Column>

        <Column style={{ verticalAlign: "middle", width: "42%" }}>
          <Text className="m-0 font-sans text-[10px] font-semibold leading-[15px] text-[#374151]">
            Performance
          </Text>
          <Row className="mt-[5px]" style={{ height: "45px" }}>
            <Column align="center" style={{ verticalAlign: "bottom" }}>
              <Text className="m-0 font-mono text-[7px] leading-[10px] text-[#374151]">+2,1%</Text>
              <Text className="mx-auto mb-0 mt-[2px] h-[13px] w-[12px] rounded-t-[2px] bg-[#c4b5fd] text-[0px] leading-[13px]">&nbsp;</Text>
            </Column>
            <Column align="center" style={{ verticalAlign: "bottom" }}>
              <Text className="m-0 font-mono text-[7px] leading-[10px] text-[#374151]">+8,4%</Text>
              <Text className="mx-auto mb-0 mt-[2px] h-[25px] w-[12px] rounded-t-[2px] bg-[#8b5cf6] text-[0px] leading-[25px]">&nbsp;</Text>
            </Column>
            <Column align="center" style={{ verticalAlign: "bottom" }}>
              <Text className="m-0 font-mono text-[7px] leading-[10px] text-[#374151]">+11,7%</Text>
              <Text className="mx-auto mb-0 mt-[2px] h-[36px] w-[12px] rounded-t-[2px] bg-[#7c3aed] text-[0px] leading-[36px]">&nbsp;</Text>
            </Column>
          </Row>
          <Row className="mt-[2px]">
            <Column align="center"><Text className="m-0 font-sans text-[7px] leading-[10px] text-[#6b7280]">1M</Text></Column>
            <Column align="center"><Text className="m-0 font-sans text-[7px] leading-[10px] text-[#6b7280]">YTD</Text></Column>
            <Column align="center"><Text className="m-0 font-sans text-[7px] leading-[10px] text-[#6b7280]">1A</Text></Column>
          </Row>
        </Column>
      </Row>
    </Section>
  );
}

export function PerformancePreview() {
  return (
    <Section className={cardClass} aria-label="Exemplo de performance por período">
      <Row>
        <Column>
          <Text className="m-0 font-sans text-[14px] font-semibold leading-[21px] text-[#111111]">
            Performance por período
          </Text>
        </Column>
        <Column align="right">
          <Text className="m-0 font-sans text-[10px] leading-[16px] text-[#9ca3af]">
            EXEMPLO
          </Text>
        </Column>
      </Row>
      <Hr className="my-[12px] border-[#f0f1f3]" />
      <Row>
        <Column><Text className={labelClass}>1 mês</Text><Text className={valueClass}>+2,1%</Text></Column>
        <Column align="center"><Text className={labelClass}>Ano até à data</Text><Text className={valueClass}>+8,4%</Text></Column>
        <Column align="right"><Text className={labelClass}>1 ano</Text><Text className={valueClass}>+11,7%</Text></Column>
      </Row>
    </Section>
  );
}

export function AllocationPreview() {
  return (
    <Section className={cardClass} aria-label="Exemplo de alocação de ativos">
      <Row>
        <Column><Text className="m-0 font-sans text-[14px] font-semibold leading-[21px] text-[#111111]">Alocação</Text></Column>
        <Column align="right"><Text className="m-0 font-sans text-[10px] leading-[16px] text-[#9ca3af]">EXEMPLO</Text></Column>
      </Row>
      <Section className="mt-[13px]">
        <AllocationRow
          label="ETFs e fundos"
          amount="€11.702,64"
          value="48%"
        />
        <AllocationRow
          label="Ações"
          amount="€7.801,76"
          value="32%"
          color="#4f46e5"
        />
        <AllocationRow
          label="Outros ativos"
          amount="€4.876,10"
          value="20%"
          color="#64748b"
        />
      </Section>
      <Section className="mt-[5px] rounded-[6px] bg-[#f7f8fa] px-[10px] py-[8px]">
        <Row>
          <Column>
            <Text className="m-0 font-sans text-[12px] font-medium leading-[18px] text-[#374151]">
              Total alocado
            </Text>
          </Column>
          <Column align="right">
            <Text className="m-0 font-mono text-[12px] font-semibold leading-[18px] text-[#111111]">
              €24.380,50 · 100%
            </Text>
          </Column>
        </Row>
      </Section>
    </Section>
  );
}

export function BenchmarkPreview() {
  return (
    <Section className={cardClass} aria-label="Exemplo de comparação com benchmark e portefólios">
      <Row>
        <Column><Text className="m-0 font-sans text-[14px] font-semibold leading-[21px] text-[#111111]">Benchmark e portefólios</Text></Column>
        <Column align="right"><Text className="m-0 font-sans text-[10px] leading-[16px] text-[#9ca3af]">EXEMPLO · YTD</Text></Column>
      </Row>
      <Hr className="my-[12px] border-[#f0f1f3]" />
      <Row>
        <Column><Text className={labelClass}>Visão consolidada</Text><Text className={valueClass}>+8,4%</Text></Column>
        <Column align="center"><Text className={labelClass}>Benchmark</Text><Text className={valueClass}>+7,1%</Text></Column>
        <Column align="right"><Text className={labelClass}>Portefólios</Text><Text className={valueClass}>3</Text></Column>
      </Row>
      <Text className="m-0 mt-[12px] font-sans text-[11px] leading-[17px] text-[#6b7280]">
        Vê cada portefólio em separado ou todos numa única visão consolidada.
      </Text>
    </Section>
  );
}
