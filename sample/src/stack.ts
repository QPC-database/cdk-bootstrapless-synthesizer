import * as path from 'path';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as lambda from '@aws-cdk/aws-lambda';
import { DockerImageAsset } from '@aws-cdk/aws-ecr-assets';
import { CfnOutput, Construct, Stack, StackProps, CfnMapping, Aws } from '@aws-cdk/core';

class MyImage implements ec2.IMachineImage {
  private mapping: { [k1: string]: { [k2: string]: any } } = {};
  constructor(readonly amiMap: { [region: string]: string }) {
    for (const [region, ami] of Object.entries(amiMap)) {
      this.mapping[region] = { ami };
    }
  }
  public getImage(parent: Construct): ec2.MachineImageConfig {
    const amiMap = new CfnMapping(parent, 'AmiMap', { mapping: this.mapping });
    return {
      imageId: amiMap.findInMap(Aws.REGION, 'ami'),
      userData: ec2.UserData.forLinux(),
      osType: ec2.OperatingSystemType.LINUX,
    };
  }
}

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const image = new DockerImageAsset(this, 'MyBuildImage', {
      directory: path.join(__dirname, '../docker')
    });

    new CfnOutput(this, 'output', { value: image.imageUri });

    new ec2.Instance(this, 'Instance', {
      vpc:  new ec2.Vpc(this, 'VPC'),
      instanceType: new ec2.InstanceType('t2.micro'),
      machineImage: new MyImage({
        'cn-north-1': 'ami-cn-north-1',
        'cn-northwest-1': 'ami-cn-northwest-1',
      }),
    });

    const layer = new lambda.LayerVersion(this, 'MyLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/'), {
        bundling: {
          image: lambda.Runtime.NODEJS_12_X.bundlingDockerImage,
          command: [
            'bash', '-xc', [
              'export npm_config_update_notifier=false',
              'export npm_config_cache=$(mktemp -d)', // https://github.com/aws/aws-cdk/issues/8707#issuecomment-757435414
              'cd $(mktemp -d)',
              'cp -v /asset-input/package*.json .',
              'npm i --only=prod',
              'mkdir -p /asset-output/nodejs/',
              'cp -au node_modules /asset-output/nodejs/',
            ].join('&&'),
          ],
        },
      }),
      compatibleRuntimes: [lambda.Runtime.NODEJS_12_X],
      description: 'A layer to test the L2 construct',
    });

    new lambda.Function(this, 'MyHandler', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/src')),
      handler: 'index.handler',
      layers: [layer],
    });
  }
}
