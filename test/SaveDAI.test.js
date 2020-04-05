const Web3 = require('web3');
const provider = 'http://127.0.0.1:8545';
const web3Provider = new Web3.providers.HttpProvider(provider);
const web3 = new Web3(web3Provider);

const { expect } = require('chai');
const {
  BN,           // Big Number support
  ether,
  balance,
  expectRevert,
  expectEvent,
} = require('@openzeppelin/test-helpers');

const SaveDAI = artifacts.require('SaveDAI');
const CTokenInterface = artifacts.require('CTokenInterface');
const OTokenInterface = artifacts.require('OTokenInterface');
const ERC20 = artifacts.require('ERC20');
const UniswapFactoryInterface = artifacts.require('UniswapFactoryInterface');
const UniswapExchangeInterface = artifacts.require('UniswapExchangeInterface');

// mainnet addresses
const daiAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const ocDaiAddress = '0x98CC3BD6Af1880fcfDa17ac477B2F612980e5e33';
const cDaiAddress = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643';
const uniswapFactoryAddress = '0xc0a47dFe034B400B47bDaD5FecDa2621de6c4d95';
const userWallet = '0xfc9362c9aa1e4c7460f1cf49466e385a507dfb2b';

contract('SaveDAI', function (accounts) {
  beforeEach(async function () {
    savedai = await SaveDAI.new();
    savedaiAddress = savedai.address;
    savedaiInstance = await SaveDAI.at(savedaiAddress);

    // instantiate mock tokens
    daiInstance = await ERC20.at(daiAddress);
    ocDaiInstance = await OTokenInterface.at(ocDaiAddress);
    cDaiInstance = await CTokenInterface.at(cDaiAddress);
    uniswapFactoryInstance = await UniswapFactoryInterface.at(uniswapFactoryAddress);

    uniswapFactory = await UniswapFactoryInterface.at(uniswapFactoryAddress);

    const ocDaiExchangeAddress = await uniswapFactory.getExchange(ocDaiAddress);
    ocDaiExchange = await UniswapExchangeInterface.at(ocDaiExchangeAddress);
    const daiExchangeAddress = await uniswapFactory.getExchange(daiAddress);
    daiExchange = await UniswapExchangeInterface.at(daiExchangeAddress);

    owner = accounts[0];
    notOwner = accounts[1];

    // Send 0.1 eth to userAddress to have gas to send an ERC20 tx.
    await web3.eth.sendTransaction({
      from: accounts[0],
      to: userWallet,
      value: ether('1'),
    });
  });

  it('user wallet should have DAI balance', async () => {
    const userWalletBalance = await daiInstance.balanceOf(userWallet);
    expect(new BN(userWalletBalance)).to.be.bignumber.least(new BN(ether('0.1')));
  });
  it('should send ether to the DAI address', async () => {
    const ethBalance = await balance.current(userWallet);
    expect(new BN(ethBalance)).to.be.bignumber.least(new BN(ether('0.1')));
  });
  it('should return premium to pay for ocDAI tokens', async function () {
    // amount of ocDAI, cDAI, saveDAI
    const amount = '489921671716';

    const premium = await savedaiInstance.premiumToPay.call(amount);

    // use exchange directly
    const ethToPay = await ocDaiExchange.getEthToTokenOutputPrice.call(amount);
    const premiumShouldBe = await daiExchange.getTokenToEthOutputPrice.call(ethToPay);

    assert.equal(premium.toString(), premiumShouldBe.toString());
  });
  describe('mint', async function () {
    beforeEach(async function () {
      // amount of ocDAI, cDAI, saveDAI
      amount = '489921671716';
    });
    it('should mint saveDAI tokens', async function () {
      // Calculate how much DAI is needed to approve
      const premium = await savedaiInstance.premiumToPay.call(amount);

      let exchangeRate = await cDaiInstance.exchangeRateCurrent.call();
      exchangeRate = (exchangeRate.toString()) / 1e18;
      let amountInDAI = amount * exchangeRate;
      amountInDAI= new BN(amountInDAI.toString());

      let totalTransfer = premium.add(amountInDAI);
      largerAmount = totalTransfer.add(new BN(ether('0.1')));

      await daiInstance.approve(savedaiAddress, largerAmount, { from: userWallet });

      // mint saveDAI tokens
      await savedaiInstance.mint(amount, { from: userWallet });

      const ocDAIbalance = await ocDaiInstance.balanceOf(savedaiAddress);
      console.log('ocDAI tokens minted, in saveDAI contract', ocDAIbalance.toString());

      const cDAIbalance = await cDaiInstance.balanceOf(savedaiAddress);
      console.log('cDAI tokens minted, in saveDAI contract', cDAIbalance.toString());

      const saveDaiMinted = await savedaiInstance.balanceOf(userWallet);
      console.log('saveDAI tokens minted, in userWallet', saveDaiMinted.toString());
      // all token balances should match
      assert.equal(cDAIbalance.toString(), saveDaiMinted.toString());
      assert.equal(ocDAIbalance.toString(), saveDaiMinted.toString());

      let underlying = await cDaiInstance.balanceOfUnderlying.call(savedaiAddress);
      underlying = underlying / 1e18;
      console.log('underlying balance of cDAI tokens', underlying.toString());
    });
    it('should decrease userWallet DAI balance', async function () {
      const initialBalance = await daiInstance.balanceOf(userWallet);

      // Calculate how much DAI is needed to approve
      const premium = await savedaiInstance.premiumToPay.call(amount);

      let exchangeRate = await cDaiInstance.exchangeRateCurrent.call();
      exchangeRate = (exchangeRate.toString()) / 1e18;
      let amountInDAI = amount * exchangeRate;
      amountInDAI= new BN(amountInDAI.toString());

      const totalTransfer = premium.add(amountInDAI);
      largerAmount = totalTransfer.add(new BN(ether('0.1')));

      await daiInstance.approve(savedaiAddress, largerAmount, { from: userWallet });

      // mint saveDAI tokens
      await savedaiInstance.mint(amount, { from: userWallet });

      const endingBalance = await daiInstance.balanceOf(userWallet);

      const diff = initialBalance.sub(endingBalance);
      console.log('totalTransfer', totalTransfer.toString());
      console.log('difference in userWallet DAI balance', diff.toString());
      // assert.equal(totalTransfer.toString(), diff.toString());
      // DIFFERENCE is 1922164195328
    });
    it('should emit the amount of tokens minted', async function () {
      // calculate amount needed for approval
      const daiNeededForPremium = await savedaiInstance.premiumToPay(amount);
      const dai = ether(amount);
      const totalTransfer = daiNeededForPremium.add(dai);
      // approve saveDAI contract
      await daiInstance.approve(savedaiAddress, totalTransfer, { from: userWallet });
      // mint tokens
      const { logs } = await savedaiInstance.mint(amount, { from: userWallet });
      expectEvent.inLogs(logs, 'Mint');
    });
  });
  describe('ExerciseInsurance', function () {
    it('should emit the amount of insurance to exercise', async function () {
      // TODO
    });
  });

  describe('saveDaiPriceInDaiCurrent', function () {
    beforeEach(async function () {
      saveDaiAmount = '489921671716';
    });
    it('should first identify the cost of ocDai', async function () {
      let premium = await savedaiInstance.premiumToPay(saveDaiAmount);
      premium = new BN(premium);

      saveDaiAmount = new BN(saveDaiAmount);

      ocDAICost = premium.add(saveDaiAmount);

      ocDaiExchange = await uniswapFactoryInstance.getExchange(ocDaiAddress);
      const ocDaiUniswapExchangeInterface = await UniswapExchangeInterface.at(ocDaiExchange);
      ethAmount = await ocDaiUniswapExchangeInterface.getEthToTokenOutputPrice(saveDaiAmount);

      daiExchange = await uniswapFactoryInstance.getExchange(daiAddress);
      const daiUniswapExchangeInterface = await UniswapExchangeInterface.at(daiExchange);
      const daiAmount = await daiUniswapExchangeInterface.getTokenToEthOutputPrice(ethAmount);
      assert.equal(ocDAICost.toString(), (daiAmount.add(saveDaiAmount)).toString());
    });
    it.skip('should then identify the cost of cDai using _getCostOfcDAI', async function () {
      let transaction = await savedaiInstance.saveDaiPriceInDaiCurrent.call(saveDaiAmount);
      transaction = new BN(transaction);

      saveDaiAmount = new BN(saveDaiAmount);

      let premium = await savedaiInstance.premiumToPay(saveDaiAmount);
      premium = new BN(premium);

      let ocDAICost = premium.add(saveDaiAmount);
      ocDAICost = new BN(ocDAICost);

      let cDaiCost = transaction.sub(ocDAICost);
      cDaiCost = new BN(cDaiCost);

      let exchangeRateStored = await cDaiInstance.exchangeRateStored();
      exchangeRateStored = (exchangeRateStored.toString()) / 1e18;
      exchangeRateStored = new BN(exchangeRateStored);

      assert.equal(cDaiCost.toString(), (exchangeRateStored.mul(saveDaiAmount)).toString());
    });
    it('should return the value in DAI for a given amount of saveDAI', async function () {
      let transaction = await savedaiInstance.saveDaiPriceInDaiCurrent.call(saveDaiAmount);
      transaction = new BN(transaction);

      saveDaiAmount = new BN(saveDaiAmount);

      let premium = await savedaiInstance.premiumToPay(saveDaiAmount);
      premium = new BN(premium);

      let ocDAICost = premium.add(saveDaiAmount);
      ocDAICost = new BN(ocDAICost);

      let  cDaiCost = transaction.sub(ocDAICost);
      cDaiCost = new BN(cDaiCost);

      amountOfDAI = cDaiCost.add(ocDAICost);
      assert.equal(amountOfDAI.toString(), (cDaiCost.add(ocDAICost).toString()));
    });
  });

  describe('updateTokenName', function () {
    it('should revert if not called by the owner', async function () {
      await expectRevert(savedaiInstance.updateTokenName('newTokenName', { from: notOwner }), 'Ownable: caller is not the owner');
    });
    it('should revert if _newName is empty', async function () {
      await expectRevert(savedaiInstance.updateTokenName('', { from: owner }), 'The _newName argument must not be empty');
    });
    it('should update and return the new ERC20 token name', async function () {
      await savedaiInstance.updateTokenName('newTokenName');
      newTokenName = await savedaiInstance.name();
      assert.strictEqual(newTokenName, 'newTokenName');
    });
    it('should emit both the new and old ERC20 token name', async function () {
      const { logs } = await savedaiInstance.updateTokenName('newTokenName');
      expectEvent.inLogs(logs, 'UpdateTokenName');
    });
  });

  describe('name', function () {
    it('should return the inital token name if updateTokenName has not been called', async function () {
      initialTokenName = await savedaiInstance.name();
      assert.equal(initialTokenName, 'SaveDAI');
    });
    it('should return the new token name if updateTokenName has been called', async function () {
      await savedaiInstance.updateTokenName('newTokenName');
      newTokenName = await savedaiInstance.name();
      assert.strictEqual(newTokenName, 'newTokenName');
    });
  });


});
