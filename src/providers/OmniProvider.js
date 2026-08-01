const BaseProvider = require('./BaseProvider');
class OmniProvider extends BaseProvider { async execute(input, options) { if (/api\.example\.com/.test(this.config.base_url)) throw Object.assign(new Error('Omni requires a vendor-issued API endpoint and access contract.'), { status: 501 }); return super.execute(input, options); } }
module.exports = OmniProvider;
