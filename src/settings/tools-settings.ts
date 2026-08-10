import { requiredElement } from "./dom.ts";
import { sendMessage } from "./runtime-client.ts";
import { showToast } from "./toast.ts";

const form = requiredElement<HTMLFormElement>("#rule-match-form");
const input = requiredElement<HTMLInputElement>("#rule-match-input");
const result = requiredElement<HTMLElement>("#rule-match-result");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage<{ hostname: string; action: string; matched: boolean; rule?: { type: string; value: string } }>({ type: "TEST_RULE_MATCH", input: input.value })
    .then((response) => {
      if (!response.ok || !response.data) throw new Error(response.error ?? "规则匹配失败");
      const action = response.data.action === "DIRECT" ? "直连" : `节点 ${response.data.action}`;
      const detail = response.data.matched && response.data.rule ? `命中 ${response.data.rule.type},${response.data.rule.value}` : "命中最终 MATCH";
      result.textContent = `${response.data.hostname} → ${action} · ${detail}`;
      result.hidden = false;
    })
    .catch((error) => { result.hidden = true; showToast(error instanceof Error ? error.message : "规则匹配失败", "error"); });
});
