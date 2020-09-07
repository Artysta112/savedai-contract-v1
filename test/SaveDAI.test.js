const Web3 = require('web3');
const provider = 'http://127.0.0.1:8545';
const web3Provider = new Web3.providers.HttpProvider(provider);
const web3 = new Web3(web3Provider);
const helpers = require('./helpers/helpers.js');

const { expect } = require('chai');

const {
  BN,
  ether,
  time,
  balance,
  expectRevert,
  expectEvent,
} = require('@openzeppelin/test-helpers');

const SaveDAI = artifacts.require('SaveDAI');
const SaveTokenFarmer = artifacts.require('SaveTokenFarmer');
const CTokenInterface = artifacts.require('CTokenInterface');
const OTokenInterface = artifacts.require('OTokenInterface');
const ERC20 = artifacts.require('ERC20');
const UniswapFactoryInterface = artifacts.require('UniswapFactoryInterface');
const UniswapExchangeInterface = artifacts.require('UniswapExchangeInterface');
const Pauser = '0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a';

// mainnet addresses
const daiAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const ocDaiAddress = '0x98CC3BD6Af1880fcfDa17ac477B2F612980e5e33';
const cDaiAddress = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643';
const uniswapFactoryAddress = '0xc0a47dFe034B400B47bDaD5FecDa2621de6c4d95';
const userWallet = '0x897607ab556177b0e0938541073ac1e01c55e483';

contract('SaveDAI', function (accounts) {
  // amount of ocDAI, cDAI, saveDAI we want to mint
  amount = '4892167171';
  owner = accounts[0];
  notOwner = accounts[1];

  // Number of seconds to increase to ensure February 21st, 2021 has elapsed
  increaseTime = 26409094;

  beforeEach(async () => {
    // deploys the farmer's logic contract
    saveTokenFarmer = await SaveTokenFarmer.new();
    saveTokenFarmerAddress = saveTokenFarmer.address;

    savedai = await SaveDAI.new(
      uniswapFactoryAddress,
      cDaiAddress,
      ocDaiAddress,
      daiAddress,
      saveTokenFarmerAddress,
    );
    savedaiAddress = savedai.address;
    savedaiInstance = await SaveDAI.at(savedaiAddress);

    // instantiate mock tokens
    daiInstance = await ERC20.at(daiAddress);
    ocDaiInstance = await OTokenInterface.at(ocDaiAddress);
    cDaiInstance = await CTokenInterface.at(cDaiAddress);
    uniswapFactory = await UniswapFactoryInterface.at(uniswapFactoryAddress);

    const ocDaiExchangeAddress = await uniswapFactory.getExchange(ocDaiAddress);
    ocDaiExchange = await UniswapExchangeInterface.at(ocDaiExchangeAddress);
    const daiExchangeAddress = await uniswapFactory.getExchange(daiAddress);
    daiExchange = await UniswapExchangeInterface.at(daiExchangeAddress);

    // Send eth to userAddress to have gas to send an ERC20 tx.
    await web3.eth.sendTransaction({
      from: owner,
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
  describe('constructor', async () => {
    it('should set decimals to 8', async () => {
      assert.equal(await savedaiInstance.decimals(), 8);
    });
    it('should set the Pauser role', async () => {
      assert.isTrue(await savedaiInstance.hasRole(Pauser, owner));
    });
  });
  describe('mint', async () => {
    it('should revert if paused', async () => {
      await savedaiInstance.pause({ from: owner });
      // mint saveDAI tokens
      await expectRevert(helpers.mint(amount, { from: userWallet }), 'Pausable: paused');
    });
    it('should mint saveDAI tokens', async () => {
      // Calculate how much DAI is needed to approve
      const premium = await savedaiInstance.getCostOfOToken.call(amount);

      let exchangeRate = await cDaiInstance.exchangeRateStored.call();
      exchangeRate = (exchangeRate.toString()) / 1e18;
      let amountInDAI = amount * exchangeRate;
      amountInDAI = new BN(amountInDAI.toString());

      const totalTransfer = premium.add(amountInDAI);
      largerAmount = totalTransfer.add(new BN(ether('0.1')));

      await daiInstance.approve(savedaiAddress, largerAmount, { from: userWallet });

      // mint saveDAI tokens
      await savedaiInstance.mint(amount, { from: userWallet });

      const ocDAIbalance = await ocDaiInstance.balanceOf(savedaiAddress);
      const cDAIbalance = await cDaiInstance.balanceOf(savedaiAddress);
      const saveDaiMinted = await savedaiInstance.balanceOf(userWallet);

      // all token balances should match
      assert.equal(cDAIbalance.toString(), amount);
      assert.equal(ocDAIbalance.toString(), amount);
      assert.equal(saveDaiMinted.toString(), amount);
    });
    it('should decrease userWallet DAI balance', async () => {
      const initialBalance = await daiInstance.balanceOf(userWallet);

      // Calculate how much DAI is needed to approve
      const premium = await savedaiInstance.getCostOfOToken.call(amount);

      await daiInstance.approve(savedaiAddress, initialBalance, { from: userWallet });

      // mint saveDAI tokens
      const transaction = await savedaiInstance.mint(amount, { from: userWallet });
      let exchangeRateTransaction = await transaction.logs[0].args._exchangeRateCurrent;
      exchangeRateTransaction = new BN(exchangeRateTransaction.toString()) / 1e18;

      // calculate how much DAI is spent using value from ExchangeRate event
      let daiFromExchangeRateEvent = exchangeRateTransaction * amount;
      daiFromExchangeRateEvent = new BN(daiFromExchangeRateEvent.toString());

      const daiTotalTransfer = premium.add(daiFromExchangeRateEvent) / 1e18;

      const endingBalance = await daiInstance.balanceOf(userWallet);

      const diff = initialBalance.sub(endingBalance) / 1e18;

      assert.equal(daiTotalTransfer.toString().substring(0, 10), diff.toString().substring(0, 10));
    });
    it('should emit the amount of tokens minted', async () => {
      // calculate amount needed for approval
      const daiNeededForPremium = await savedaiInstance.getCostOfOToken(amount);
      const dai = ether(amount);
      const totalTransfer = daiNeededForPremium.add(dai);
      // approve saveDAI contract
      await daiInstance.approve(savedaiAddress, totalTransfer, { from: userWallet });
      // mint tokens
      const { logs } = await savedaiInstance.mint(amount, { from: userWallet });
      expectEvent.inLogs(logs, 'Mint');
    });
    it('should return true', async () => {
      // Calculate how much DAI is needed to approve
      const premium = await savedaiInstance.getCostOfOToken.call(amount);

      let exchangeRate = await cDaiInstance.exchangeRateStored.call();
      exchangeRate = (exchangeRate.toString()) / 1e18;
      let amountInDAI = amount * exchangeRate;
      amountInDAI = new BN(amountInDAI.toString());

      const totalTransfer = premium.add(amountInDAI);
      largerAmount = totalTransfer.add(new BN(ether('0.1')));

      await daiInstance.approve(savedaiAddress, largerAmount, { from: userWallet });

      // mint saveDAI tokens
      const bool = await savedaiInstance.mint.call(amount, { from: userWallet });
      assert.isTrue(bool);
    });
  });
  describe('getCostOfOToken', function () {
    it('should return premium to pay for ocDAI tokens', async () => {
      const premium = await savedaiInstance.getCostOfOToken.call(amount);

      // use exchange directly
      const ethToPay = await ocDaiExchange.getEthToTokenOutputPrice.call(amount);
      const premiumShouldBe = await daiExchange.getTokenToEthOutputPrice.call(ethToPay);

      assert.equal(premium.toString(), premiumShouldBe.toString());
    });
  });
  describe('pause', function () {
    it('should revert if not called by admin', async () => {
      await expectRevert(savedaiInstance.pause({ from: notOwner }), 'Caller must be admin');
    });
    it('should pause the contract', async () => {
      assert.isFalse(await savedaiInstance.paused());
      await savedaiInstance.pause({ from: owner });
      assert.isTrue(await savedaiInstance.paused());
    });
  });
  describe('unpause', function () {
    it('should revert if not called by admin', async () => {
      await expectRevert(savedaiInstance.unpause({ from: notOwner }), 'Caller must be admin');
    });
    it('should unpause the contract', async () => {
      await savedaiInstance.pause({ from: owner });
      assert.isTrue(await savedaiInstance.paused());
      await savedaiInstance.unpause({ from: owner });
      assert.isFalse(await savedaiInstance.paused());
    });
  });
  describe('saveDaiPriceInDaiCurrent', function () {
    it('should first identify the cost of ocDai', async () => {
      let premium = await savedaiInstance.getCostOfOToken(amount);
      premium = new BN(premium);

      ethAmount = await ocDaiExchange.getEthToTokenOutputPrice(amount);
      const daiAmount = await daiExchange.getTokenToEthOutputPrice(ethAmount);

      assert.equal(premium.toString(), daiAmount.toString());
    });
    it('should then identify the cost of cDai using _getCostOfcDAI', async () => {
      amount -= 1; // account for rounding issue
      const saveDaiPrice = await savedaiInstance.saveDaiPriceInDaiCurrent.call(amount) / 1e18;

      const premium = await savedaiInstance.getCostOfOToken(amount) / 1e18;

      const cDaiCostFromSaveDAIprice = saveDaiPrice - premium;

      let cDaiCostFromExchangeRate = await cDaiInstance.exchangeRateStored();
      cDaiCostFromExchangeRate = (cDaiCostFromExchangeRate * amount)  / 1e18;

      assert.approximately(cDaiCostFromSaveDAIprice, cDaiCostFromExchangeRate.toString() / 1e18, 0.0001);
    });
    it('should return the value in DAI for a given amount of saveDAI', async () => {
      let transaction = await savedaiInstance.saveDaiPriceInDaiCurrent.call(amount);
      transaction = new BN(transaction);

      amount = new BN(amount);

      let premium = await savedaiInstance.getCostOfOToken(amount);
      premium = new BN(premium);

      let cDaiCost = transaction.sub(premium);
      cDaiCost = new BN(cDaiCost);

      amountOfDAI = cDaiCost.add(premium);
      assert.equal(amountOfDAI.toString(), transaction.toString());
    });
  });
  context('when ocDAI has NOT expired', function () {
    beforeEach(async () => {
      // Mint SaveDAI tokens
      await helpers.mint(amount);
      saveDai = await savedaiInstance.balanceOf(userWallet);
      saveDai = saveDai.toNumber();
    });
    describe('withdrawForAssetandOTokens', function () {
      it('should transfer _amount of ocDAI to msg.sender', async () => {
        // Idenitfy the user's initial ocDAI balance
        const initialBalance = await ocDaiInstance.balanceOf(userWallet);

        // Remove userWallet's insurance
        // unbundle saveDAI and send user back _amount of ocDAI
        await savedaiInstance.withdrawForAssetandOTokens(saveDai, { from: userWallet });

        // Idenitfy the user's ocDAI balance after receiving ocDAI
        const finalUserBalance = await ocDaiInstance.balanceOf(userWallet);

        // Calculate the difference in ocDAI tokens
        const diff = finalUserBalance - initialBalance;

        assert.equal(diff, saveDai);
      });
      it('should transfer _amount of cDAI to msg.sender', async () => {
        // Idenitfy the user's initial cDAI balance
        const initialBalance = await cDaiInstance.balanceOf(userWallet);

        // Remove userWallelt's insurance
        // unbundle saveDAI and send user back _amount of cDAI
        await savedaiInstance.withdrawForAssetandOTokens(saveDai, { from: userWallet });

        // Idenitfy the user's cDAI balance after receiving cDAI
        const finalUserBalance = await cDaiInstance.balanceOf(userWallet);

        // Calculate the difference in cDAI tokens
        const diff = finalUserBalance - initialBalance;

        assert.equal(diff, saveDai);
      });
      it('should emit a WithdrawForAssetandOTokens event with the msg.sender\'s address and their _amount of insurance removed', async () => {
        // Remove _amount of userWallelt's insurance
        const transaction = await savedaiInstance.withdrawForAssetandOTokens(saveDai, { from: userWallet });
        // assert WithdrawForAssetandOTokens fires
        const event = await transaction.logs[3].event;
        assert.equal(event, 'WithdrawForAssetandOTokens');

        // assert msg.sender's address emits in the event
        const userAddress = await transaction.logs[3].args._user;
        assert.equal(userAddress.toLowerCase(), userWallet);

        // assert the correct amount of ocDAI insurance coverage was removed
        const insuranceRemovedAmount = await transaction.logs[3].args._amount;
        assert.equal(insuranceRemovedAmount.toString(), saveDai);
      });
      it('should burn _amount of msg.sender\'s saveDAI tokens', async () => {
        // Idenitfy the user's initial saveDAI balance
        const initialSaveDaiBalance = await savedaiInstance.balanceOf(userWallet);

        // Remove _amount of userWallelt's insurance
        await savedaiInstance.withdrawForAssetandOTokens(saveDai, { from: userWallet });

        // Idenitfy the user's final saveDAI balance
        const finalSaveDaiBalance = await savedaiInstance.balanceOf(userWallet);

        // Calculate the difference in user's saveDAI tokens after removing insurance
        const diff = initialSaveDaiBalance - finalSaveDaiBalance;

        assert.equal(diff, saveDai);
      });
    });

    describe('withdrawForAsset', function () {
      it('should transfer cDAI from saveDAI contract to user', async () => {
        // Identify initial cDAI balances
        const initialcDaiBalanceContract = await cDaiInstance.balanceOf(savedaiAddress);
        const initialcDAIbalanceUser = await cDaiInstance.balanceOf(userWallet);

        // Calculate how much cDAI you will receive from swapping ocDAI
        // 1. swap ocDAI for DAI on uniswap
        const cDaiAmount = saveDai; // cDai amount is the same as saveDai
        const eth = await ocDaiExchange.getTokenToEthInputPrice(cDaiAmount);
        const daiBought = await daiExchange.getEthToTokenInputPrice(eth);

        // 2. calculate how much cDAI will be minted
        const exchangeRate = await cDaiInstance.exchangeRateStored.call();

        // subtract 1 to account for rounding issue when calculating cDai minted
        let cDaiMinted = ((daiBought.toString() * 1e18) / exchangeRate.toString()) - 1;
        cDaiMinted = new BN(cDaiMinted);

        // Remove userWallet's insurance
        await savedaiInstance.withdrawForAsset(saveDai, { from: userWallet });

        // Identify final cDAI balance in saveDAI contract
        const finalcDAIbalanceContract = await cDaiInstance.balanceOf(savedaiAddress);

        // Identify final cDAI balance in userWallet
        const finalcDAIbalanceUser = await cDaiInstance.balanceOf(userWallet);

        diffInContract = initialcDaiBalanceContract.sub(finalcDAIbalanceContract).add(cDaiMinted);
        diffInUser = finalcDAIbalanceUser.sub(initialcDAIbalanceUser);

        assert.equal(diffInContract.toString().substring(0, 7), diffInUser.toString().substring(0, 7));
      });
      it('should emit a WithdrawForAsset event with the msg.sender\'s address and their total balance of insurance removed', async () => {
        const transaction = await savedaiInstance.withdrawForAsset(saveDai, { from: userWallet });
        // assert WithdrawForAsset fires
        const event = await transaction.logs[8].event;
        assert.equal(event, 'WithdrawForAsset');

        // assert msg.sender's address emits in the event
        const userAddress = await transaction.logs[8].args._user;
        assert.equal(userAddress.toLowerCase(), userWallet);

        // assert the correct amount of ocDAI (insurance) was removed
        const insuranceRemovedAmount = await transaction.logs[8].args._amount;
        assert.equal(insuranceRemovedAmount.toString(), saveDai);
      });
      it('should burn the amount of msg.sender\'s saveDAI tokens', async () => {
        const initialSaveDaiBalance = await savedaiInstance.balanceOf(userWallet);

        // Remove userWallelt's insurance
        // unbundle saveDAI and send user back _amount of cDAI plus newly minted cDAI
        await savedaiInstance.withdrawForAsset(saveDai, { from: userWallet });

        // Idenitfy the user's finanl saveDAI balance
        const finalSaveDaiBalance = await savedaiInstance.balanceOf(userWallet);

        // Calculate the difference in saveDAI tokens
        const diff = initialSaveDaiBalance - finalSaveDaiBalance;

        assert.equal(diff, saveDai);
      });
    });

    describe('withdrawForUnderlyingAsset', function () {
      it('should decrease saveDAI contract by cDAI and ocDAI', async () => {
        // Identify initial balances
        const initialcDaiBalanceContract = await cDaiInstance.balanceOf(savedaiAddress);
        const initialocDaiBalanceContract = await ocDaiInstance.balanceOf(savedaiAddress);

        // Remove userWallet's insurance
        await savedaiInstance.withdrawForUnderlyingAsset(saveDai, { from: userWallet });

        // Identify final balances
        const finalcDAIbalanceContract = await cDaiInstance.balanceOf(savedaiAddress);
        const finalocDaiBalanceContract = await ocDaiInstance.balanceOf(savedaiAddress);

        diffIncDai = initialcDaiBalanceContract.sub(finalcDAIbalanceContract);
        diffInocDai = initialocDaiBalanceContract.sub(finalocDaiBalanceContract);

        // difference in cDai and ocDai in contract should be the same as saveDAI exchanged
        assert.equal(diffIncDai.toString(), saveDai);
        assert.equal(diffInocDai.toString(), saveDai);
      });
      it('should send msg.sender the newly minted DAI', async () => {
        // Idenitfy the user's initialDaiBalance
        initialDaiBalance = await daiInstance.balanceOf(userWallet);

        // Calculate how much DAI user will receive for cDAI and ocDAI
        // 1. Get underlying value of cDai in DAI
        const cDaiAmount = saveDai; // cDai amount is the same as saveDai
        let exchangeRate = await cDaiInstance.exchangeRateStored.call();
        exchangeRate = exchangeRate / 1e18;

        const daiBought1 = (cDaiAmount * exchangeRate) / 1e18;

        // 2. calculate ocDAI for DAI on uniswap
        const eth = await ocDaiExchange.getTokenToEthInputPrice(cDaiAmount);
        let daiBought2 = await daiExchange.getEthToTokenInputPrice(eth);
        daiBought2 = daiBought2 / 1e18;

        // add 1 + 2 together, should be really close to diff
        const daiBoughtTotal = daiBought1 + daiBought2;

        // Remove userWallet's insurance
        await savedaiInstance.withdrawForUnderlyingAsset(saveDai, { from: userWallet });

        // Idenitfy the user's updatedDaiBalance
        const updatedDaiBalance = await daiInstance.balanceOf(userWallet);
        const diff = (updatedDaiBalance.sub(initialDaiBalance)) / 1e18;

        assert.approximately(daiBoughtTotal, diff, 0.000000019);
      });
      it('should emit a WithdrawForUnderlyingAsset event with the msg.sender\'s address and their total balance of insurance removed', async () => {
        const transaction = await savedaiInstance.withdrawForUnderlyingAsset(saveDai, { from: userWallet });

        // assert WithdrawForUnderlyingAsset fires
        const event = await transaction.logs[8].event;
        assert.equal(event, 'WithdrawForUnderlyingAsset');

        // assert msg.sender's address emits in the event
        const userAddress = await transaction.logs[8].args._user;
        assert.equal(userAddress.toLowerCase(), userWallet);

        // assert the correct amount of ocDAI (insurance) was removed
        const insuranceRemovedAmount = await transaction.logs[8].args._amount;
        assert.equal(insuranceRemovedAmount.toString(), saveDai);
      });
      it('should burn the amount of msg.sender\'s saveDAI tokens', async () => {
        const initialSaveDaiBalance = await savedaiInstance.balanceOf(userWallet);

        // Remove userWallelt's insurance
        // unbundle saveDAI and send user back DAI
        await savedaiInstance.withdrawForUnderlyingAsset(saveDai, { from: userWallet });

        // Idenitfy the user's finanl saveDAI balance
        const finalSaveDaiBalance = await savedaiInstance.balanceOf(userWallet);

        // Calculate the difference in saveDAI tokens
        const diff = initialSaveDaiBalance - finalSaveDaiBalance;

        assert.equal(diff, saveDai);
      });
    });

    describe('exerciseInsurance', function () {
      it('should be able to call exercise using one vault', async () => {
        const amtToExercise = await savedaiInstance.balanceOf(userWallet);
        const vaultArray = ['0x076c95c6cd2eb823acc6347fdf5b3dd9b83511e4'];

        const initialocDAIbalance = await ocDaiInstance.balanceOf(savedaiAddress);
        const initialcDAIbalance = await cDaiInstance.balanceOf(savedaiAddress);

        const totalSupplyBefore = await ocDaiInstance.totalSupply();

        initialETH = await balance.current(userWallet);

        txReceipt = await savedaiInstance.exerciseInsurance(
          amtToExercise,
          vaultArray,
          { from: userWallet },
        );

        const tx = await web3.eth.getTransaction(txReceipt.tx);
        gasUsed = new BN(txReceipt.receipt.gasUsed);
        gasPrice = new BN(tx.gasPrice);

        const deltaEth = txReceipt.receipt.logs[5].args[1];

        const expectedEndETHBalance = initialETH
          .sub(gasUsed.mul(gasPrice))
          .add(deltaEth);

        // check that the user gets the right amount of ETH back
        finalETH = await balance.current(userWallet);
        assert.equal(expectedEndETHBalance.toString(), finalETH.toString());

        // check the supply of ocDAI tokens has changed
        const totalSupplyAfter = await ocDaiInstance.totalSupply();
        assert.equal(totalSupplyBefore.sub(new BN(amtToExercise)).toString(), totalSupplyAfter.toString());

        // check that cDAI and ocDAI were transferred
        const endingocDAIbalance = await ocDaiInstance.balanceOf(savedaiAddress);
        const endingcDAIbalance = await cDaiInstance.balanceOf(savedaiAddress);
        assert.equal(initialocDAIbalance.sub(endingocDAIbalance).toString(), amtToExercise.toString());
        assert.equal(initialcDAIbalance.sub(endingcDAIbalance).toString(), amtToExercise.toString());
      });
      it('should be able to call exercise using multiple vaults', async () => {
        const amtToExercise = await savedaiInstance.balanceOf(userWallet);
        const vaultArray = ['0xd89b6d5228672ec03ab5929d625e373b4f1f25f3', '0xcae687969d3a6c4649d114b1c768d5b1deae547b'];

        const initialocDAIbalance = await ocDaiInstance.balanceOf(savedaiAddress);
        const initialcDAIbalance = await cDaiInstance.balanceOf(savedaiAddress);

        const totalSupplyBefore = await ocDaiInstance.totalSupply();

        initialETH = await balance.current(userWallet);

        txReceipt = await savedaiInstance.exerciseInsurance(
          amtToExercise,
          vaultArray,
          { from: userWallet },
        );

        const tx = await web3.eth.getTransaction(txReceipt.tx);
        gasUsed = new BN(txReceipt.receipt.gasUsed);
        gasPrice = new BN(tx.gasPrice);

        const deltaEth = txReceipt.receipt.logs[5].args[1];

        const expectedEndETHBalance = initialETH
          .sub(gasUsed.mul(gasPrice))
          .add(deltaEth);

        // check that the user gets the right amount of ETH back
        finalETH = await balance.current(userWallet);
        assert.equal(expectedEndETHBalance.toString(), finalETH.toString());

        // check the supply of ocDAI tokens has changed
        const totalSupplyAfter = await ocDaiInstance.totalSupply();
        assert.equal(totalSupplyBefore.sub(new BN(amtToExercise)).toString(), totalSupplyAfter.toString());

        // check that cDAI and ocDAI were transferred
        const endingocDAIbalance = await ocDaiInstance.balanceOf(savedaiAddress);
        const endingcDAIbalance = await cDaiInstance.balanceOf(savedaiAddress);
        assert.equal(initialocDAIbalance.sub(endingocDAIbalance).toString(), amtToExercise.toString());
        assert.equal(initialcDAIbalance.sub(endingcDAIbalance).toString(), amtToExercise.toString());
      });
      it('should emit the amount of insurance to exercise', async () => {
        const amtToExercise = await savedaiInstance.balanceOf(userWallet);
        const vaultArray = ['0x076c95c6cd2eb823acc6347fdf5b3dd9b83511e4'];

        txReceipt = await savedaiInstance.exerciseInsurance(
          amtToExercise,
          vaultArray,
          { from: userWallet },
        );

        // check that the right events were emitted
        expectEvent(txReceipt, 'ExerciseInsurance');
      });
    });
  });

  context('when ocDAI has expired', function () {
    beforeEach(async () => {
      // Mint SaveDAI tokens
      await helpers.mint(amount);
      saveDai = await savedaiInstance.balanceOf(userWallet);
      saveDai = saveDai.toNumber();
    });
    describe('withdrawForAssetandOTokens', function () {
      it('should transfer _amount of cDAI to msg.sender', async () => {
        // Increase time so ocDAI has expired
        await time.increase(increaseTime);

        // Idenitfy the user's initial cDAI balance
        const initialBalance = await cDaiInstance.balanceOf(userWallet);

        // Remove userWallelt's insurance
        // if ocDAI has expired, unbundle saveDAI and send user back _amount of cDAI
        await savedaiInstance.withdrawForAssetandOTokens(saveDai, { from: userWallet });

        // Idenitfy the user's cDAI balance after receiving cDAI
        const finalUserBalance = await cDaiInstance.balanceOf(userWallet);

        // Calculate the difference in cDAI tokens
        const diff = finalUserBalance - initialBalance;

        assert.equal(diff, saveDai);
      });
      it('should emit a WithdrawForAssetandOTokens event with the msg.sender\'s address and the amount of insurance removed', async () => {
        // Remove userWallelt's insurance
        // if ocDAI has expired, unbundle saveDAI and send user back _amount of cDAI
        const transaction = await savedaiInstance.withdrawForAssetandOTokens(saveDai, { from: userWallet });

        // assert WithdrawForAssetandOTokens fires
        const event = await transaction.logs[2].event;
        assert.equal(event, 'WithdrawForAssetandOTokens');

        // assert msg.sender's address emits in the event
        const userAddress = await transaction.logs[2].args._user;
        assert.equal(userAddress.toLowerCase(), userWallet);

        // assert the correct amount of ocDAI token coverage was removed
        const insuranceRemovedAmount = await transaction.logs[2].args._amount;

        assert.equal(insuranceRemovedAmount.toString(), saveDai);
      });
      it('should burn the amount of msg.sender\'s saveDAI tokens', async () => {
        const initialSaveDaiBalance = await savedaiInstance.balanceOf(userWallet);

        // Remove userWallelt's insurance
        // if ocDAI has expired, unbundle saveDAI and send user back _amount of cDAI
        await savedaiInstance.withdrawForAssetandOTokens(saveDai, { from: userWallet });

        // Idenitfy the user's finanl saveDAI balance
        const finalSaveDaiBalance = await savedaiInstance.balanceOf(userWallet);

        // Calculate the difference in saveDAI tokens
        const diff =  initialSaveDaiBalance - finalSaveDaiBalance;

        assert.equal(diff, saveDai);
      });
    });

    describe('withdrawForAsset', function () {
      it('should revert if ocDAI has expired', async () => {
        // Mint SaveDAI tokens
        await helpers.mint(amount);
        saveDai = await savedaiInstance.balanceOf(userWallet);
        saveDai = saveDai.toNumber();
        await expectRevert(savedaiInstance.withdrawForAsset(saveDai, { from: userWallet }), 'ocDAI must not have expired');
      });
    });

    describe('withdrawForUnderlyingAsset', function () {
      it('should revert if ocDAI has expired', async () => {
        // Mint SaveDAI tokens
        await helpers.mint(amount);
        saveDai = await savedaiInstance.balanceOf(userWallet);
        saveDai = saveDai.toNumber();
        await expectRevert(savedaiInstance.withdrawForUnderlyingAsset(saveDai, { from: userWallet }), 'ocDAI must not have expired');
      });
    });

    describe('exerciseInsurance', function () {
      it('should revert', async () => {
        const amtToExercise = await savedaiInstance.balanceOf(userWallet);
        const vaultArray = ['0x076c95c6cd2eb823acc6347fdf5b3dd9b83511e4'];

        await expectRevert(
          savedaiInstance.exerciseInsurance(
            amtToExercise,
            vaultArray,
            { from: userWallet },
          ),
          'Can\'t exercise outside of the exercise window',
        );
      });
    });
  });
});
