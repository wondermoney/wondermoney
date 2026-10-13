import { dataHealthCampaign } from '@service/lifecycle/campaigns/data-health';
import { registerCampaign } from '@service/lifecycle/lifecycle-registry';

/** Side-effect module: registers every lifecycle campaign. Import for its effect. */
registerCampaign(dataHealthCampaign);
